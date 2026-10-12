/**
 * One room, as a Durable Object. It is a thin shell: every rule lives in
 * src/lib/rooms/room.ts. This file receives a message, applies it, saves the
 * result, tells everyone, and sets an alarm for when the room must next act.
 */

import { DurableObject } from 'cloudflare:workers';

import { MESSAGE_MAX_BYTES, NAME_MAX, NOTE_MAX_BYTES, NOTE_MAX_SECONDS, NOTE_MIN_SECONDS, ROOM_NAME_MAX } from '../src/lib/rooms/limits';
import { parseEvent, viewFor, type ServerMessage } from '../src/lib/rooms/protocol';
import { apply, createRoom, wakeAt, type Outcome, type RoomEvent, type RoomState } from '../src/lib/rooms/room';

/** What is remembered about a connection across the object's sleeps. */
interface Attachment {
  device: string;
}

const DEVICE = /^[\w-]{16,64}$/;
/** Messages a device may send in a window; the excess is dropped. */
const FLOOD_LIMIT = 20;
const FLOOD_WINDOW_MS = 10_000;
const MIN_WAKE_MS = 250;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export class Room extends DurableObject {
  private state: RoomState | null | undefined;
  private readonly recent = new Map<string, number[]>();

  private async load(): Promise<RoomState | null> {
    if (this.state === undefined) this.state = (await this.ctx.storage.get<RoomState>('room')) ?? null;
    return this.state;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , , code, part, noteId] = url.pathname.split('/');
    const device = url.searchParams.get('device') ?? '';
    const now = Date.now();

    if (part === 'create' && request.method === 'POST') {
      if (!DEVICE.test(device)) return json({ error: 'bad-device' }, 400);
      const existing = await this.load();
      // The code is taken while its room is open; a closed room's code is free again.
      if (existing && !existing.closed) return json({ error: 'taken' }, 409);
      const name = (url.searchParams.get('name') ?? '').slice(0, ROOM_NAME_MAX);
      await this.ctx.storage.deleteAll();
      this.state = createRoom(code!, device, name, now);
      await this.save(now);
      return json({ code });
    }

    const room = await this.load();
    if (!room) return json({ error: 'none' }, 404);
    if (room.closed) return json({ error: 'ended' }, 410);

    if (part === 'live') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected-websocket' }, 426);
      if (!DEVICE.test(device)) return json({ error: 'bad-device' }, 400);
      const name = (url.searchParams.get('name') ?? '').slice(0, NAME_MAX);
      const outcome = apply(room, device, { type: 'join', name }, now);
      // A refusal is sent down the socket and then closed, so the app can show why.
      const pair = new WebSocketPair();
      if (outcome.refused) {
        pair[1].accept();
        pair[1].send(JSON.stringify({ type: 'refused', reason: outcome.refused } satisfies ServerMessage));
        pair[1].close(4000, outcome.refused);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ device } satisfies Attachment);
      await this.commit(outcome, now);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (part === 'notes' && request.method === 'PUT') {
      const seconds = Number(url.searchParams.get('seconds'));
      const when = url.searchParams.get('when') === 'after' ? 'after' : 'now';
      if (!(seconds >= NOTE_MIN_SECONDS && seconds <= NOTE_MAX_SECONDS + 1)) return json({ error: 'note-length' }, 400);
      const audio = await request.arrayBuffer();
      if (audio.byteLength === 0 || audio.byteLength > NOTE_MAX_BYTES) return json({ error: 'note-size' }, 413);
      const id = crypto.randomUUID();
      const outcome = apply(room, device, { type: 'note', id, seconds, when }, now);
      if (outcome.refused) return json({ error: outcome.refused }, 403);
      await this.ctx.storage.put(`note:${id}`, { type: request.headers.get('Content-Type') ?? 'audio/mp4', audio });
      await this.commit(outcome, now);
      return json({ id });
    }

    if (part === 'notes' && request.method === 'GET' && noteId) {
      // The ID is random and only sent to people in the room.
      const note = await this.ctx.storage.get<{ type: string; audio: ArrayBuffer }>(`note:${noteId}`);
      if (!note) return json({ error: 'none' }, 404);
      return new Response(note.audio, { headers: { 'Content-Type': note.type, 'Cache-Control': 'private, max-age=600' } });
    }

    return json({ error: 'not-found' }, 404);
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const { device } = socket.deserializeAttachment() as Attachment;
    if (typeof message !== 'string' || message.length > MESSAGE_MAX_BYTES || this.flooding(device)) return;
    let event: RoomEvent | null;
    try {
      event = parseEvent(JSON.parse(message));
    } catch {
      return;
    }
    const room = await this.load();
    if (!event || !room) return;
    const now = Date.now();
    const outcome = apply(room, device, event, now);
    if (outcome.refused) {
      socket.send(JSON.stringify({ type: 'refused', reason: outcome.refused } satisfies ServerMessage));
      return;
    }
    await this.commit(outcome, now);
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.left(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.left(socket);
  }

  override async alarm(): Promise<void> {
    const room = await this.load();
    if (!room || room.closed) return;
    const now = Date.now();
    await this.commit(apply(room, '', { type: 'wake' }, now), now);
  }

  private async left(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    const room = await this.load();
    if (!attachment || !room || room.closed) return;
    const now = Date.now();
    await this.commit(apply(room, attachment.device, { type: 'leave' }, now), now, socket);
  }

  private flooding(device: string): boolean {
    const now = Date.now();
    const times = (this.recent.get(device) ?? []).filter((time) => now - time < FLOOD_WINDOW_MS);
    times.push(now);
    this.recent.set(device, times);
    return times.length > FLOOD_LIMIT;
  }

  /** Save the outcome of an event and tell everyone what the room now looks like. */
  private async commit(outcome: Outcome, now: number, leaving?: WebSocket): Promise<void> {
    this.state = outcome.state;
    // The reason a song could not play is known only to the host's device; keep it for whoever runs the site.
    if (outcome.failed) console.warn('Song skipped as unplayable:', outcome.failed);
    await this.save(now);
    if (outcome.dropped.length) await this.ctx.storage.delete(outcome.dropped.map((id) => `note:${id}`));

    const sockets = this.ctx.getWebSockets().filter((socket) => socket !== leaving);
    const gone = new Set(outcome.disconnect);
    for (const socket of sockets) {
      const { device } = socket.deserializeAttachment() as Attachment;
      try {
        if (gone.has(device)) {
          const reason = outcome.state.closed ? 'ended' : 'removed';
          socket.send(JSON.stringify({ type: 'gone', reason } satisfies ServerMessage));
          socket.close(4001, reason);
          continue;
        }
        if (outcome.notice) socket.send(JSON.stringify({ type: 'notice', text: outcome.notice } satisfies ServerMessage));
        socket.send(JSON.stringify({ type: 'room', room: viewFor(outcome.state, device), now } satisfies ServerMessage));
      } catch {
        // A socket that died mid-send is cleaned up by its own close event.
      }
    }
    if (outcome.state.closed) await this.ctx.storage.deleteAll();
  }

  private async save(now: number): Promise<void> {
    const room = this.state;
    if (!room) return;
    if (room.closed) {
      // Keep only the fact that it ended, so the code answers "this room has ended" for a while.
      await this.ctx.storage.put('room', room);
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.put('room', room);
    const wake = wakeAt(room);
    if (wake === null) await this.ctx.storage.deleteAlarm();
    // Never sooner than a quarter second: even if a rule were ever wrong about when to
    // wake, a room could not spin through the day's request allowance.
    else await this.ctx.storage.setAlarm(Math.max(wake, now + MIN_WAKE_MS));
  }
}

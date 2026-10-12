/** The live connection to a room: join, receive, send, and reconnect when it drops. */

import type { ServerMessage } from '../../lib/rooms/protocol';
import type { Refusal } from '../../lib/rooms/room';

export interface ConnectionHandlers {
  message: (message: ServerMessage) => void;
  /** connected, or trying again after a drop. */
  status: (status: 'connected' | 'reconnecting') => void;
  /** The room refused the join; nothing will retry. */
  refused: (reason: Refusal | 'none') => void;
}

const RETRY_SECONDS = [1, 2, 4, 8, 15];

export class Connection {
  private socket: WebSocket | undefined;
  private attempt = 0;
  private timer = 0;
  private closed = false;
  private joined = false;

  constructor(
    private readonly code: string,
    private readonly device: string,
    private readonly name: string,
    private readonly handlers: ConnectionHandlers,
  ) {
    this.open();
  }

  send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.socket?.close();
  }

  private open(): void {
    const params = new URLSearchParams({ device: this.device, name: this.name });
    const address = `${window.location.origin.replace(/^http/, 'ws')}/api/rooms/${this.code}/live?${params}`;
    const socket = (this.socket = new WebSocket(address));
    let refused = false;

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'room') {
        if (!this.joined || this.attempt > 0) this.handlers.status('connected');
        this.joined = true;
        this.attempt = 0;
      }
      // A refusal before the room has ever been seen is a refusal to join.
      if (message.type === 'refused' && !this.joined) {
        refused = true;
        this.closed = true;
        this.handlers.refused(message.reason);
        return;
      }
      if (message.type === 'gone') this.closed = true;
      this.handlers.message(message);
    });

    socket.addEventListener('close', () => {
      if (this.closed || refused) return;
      // Never connected at all: the room does not exist or has ended.
      if (!this.joined && this.attempt === 0) {
        void this.why();
        return;
      }
      this.handlers.status('reconnecting');
      const delay = RETRY_SECONDS[Math.min(this.attempt, RETRY_SECONDS.length - 1)]!;
      this.attempt++;
      this.timer = window.setTimeout(() => this.open(), delay * 1000);
    });
  }

  /** The socket would not open; ask the room over plain HTTP why. */
  private async why(): Promise<void> {
    try {
      const response = await fetch(`/api/rooms/${this.code}/notes/none`);
      this.closed = true;
      this.handlers.refused(response.status === 410 ? 'ended' : response.status === 404 && (await response.json()).error === 'none' ? 'none' : 'ended');
    } catch {
      this.handlers.status('reconnecting');
      this.attempt++;
      this.timer = window.setTimeout(() => this.open(), 2000);
    }
  }
}

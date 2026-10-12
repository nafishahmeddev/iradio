/** What a device and its room say to each other, and the checks on what a device sends. */

import { isStreamUrl, toStation } from '../stations';
import { NAME_MAX, NAME_MIN, ROOM_NAME_MAX } from './limits';
import { canSendNotes, hostDevice, type Item, type Note, type Refusal, type RoomEvent, type RoomState, type Settings, type Source } from './room';

export interface PersonView {
  id: string;
  name: string;
  colour: number;
  host: boolean;
  here: boolean;
  listening: boolean;
  mayNote: boolean;
  askedMic: boolean;
}

export interface ItemView extends Omit<Item, 'votes'> {
  votes: number;
  voted: boolean;
}

/** The room as one person sees it. Nobody's device ID is in it. */
export interface RoomView {
  code: string;
  name: string;
  settings: Settings;
  you: { id: string; host: boolean; canAdd: boolean; canNote: boolean; askedMic: boolean; nextNoteAt: number };
  people: PersonView[];
  current: ItemView | null;
  startAt: number;
  pausedAt: number | null;
  queue: ItemView[];
  /** Notes with a moment to play, for every listening device. */
  playing: Array<Pick<Note, 'id' | 'byName' | 'colour' | 'seconds' | 'playAt'>>;
  /** Notes the viewer should know about: their own, and for the host those awaiting approval. */
  notes: Array<Pick<Note, 'id' | 'by' | 'byName' | 'colour' | 'seconds' | 'state'>>;
}

export type ServerMessage =
  | { type: 'room'; room: RoomView; now: number }
  | { type: 'refused'; reason: Refusal }
  | { type: 'notice'; text: string }
  | { type: 'gone'; reason: 'ended' | 'removed' };

export function viewFor(state: RoomState, device: string): RoomView {
  const host = hostDevice(state);
  const me = state.people.find((person) => person.device === device)!;
  const isHost = device === host;
  const item = (source: Item): ItemView => ({ ...source, votes: source.votes.length, voted: source.votes.includes(me.id) });
  return {
    code: state.code,
    name: state.name,
    settings: state.settings,
    you: {
      id: me.id,
      host: isHost,
      canAdd: state.settings.adders === 'everyone' || isHost,
      canNote: canSendNotes(state, me, isHost),
      askedMic: me.askedMic,
      nextNoteAt: me.lastNoteAt ? me.lastNoteAt + 60_000 : 0,
    },
    people: state.people
      .filter((person) => !person.removed)
      .map((person) => ({
        id: person.id,
        name: person.name,
        colour: person.colour,
        host: person.device === host,
        here: person.connections > 0,
        listening: person.listening,
        mayNote: person.mayNote,
        askedMic: person.askedMic,
      })),
    current: state.current && item(state.current),
    startAt: state.startAt,
    pausedAt: state.pausedAt,
    queue: state.queue.map(item),
    playing: state.notes
      .filter((note) => note.state === 'scheduled')
      .map(({ id, byName, colour, seconds, playAt }) => ({ id, byName, colour, seconds, playAt })),
    notes: state.notes
      .filter((note) => note.by === me.id || (isHost && note.state === 'approval'))
      .map(({ id, by, byName, colour, seconds, state: status }) => ({ id, by, byName, colour, seconds, state: status })),
  };
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value : null;

function source(value: unknown): Source | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  switch (record['kind']) {
    case 'youtube':
      return typeof record['id'] === 'string' && /^[\w-]{11}$/.test(record['id']) ? { kind: 'youtube', id: record['id'] } : null;
    case 'soundcloud':
      return isStreamUrl(record['url']) && /^https:\/\/(on\.)?soundcloud\.com\//.test(record['url'])
        ? { kind: 'soundcloud', url: record['url'] }
        : null;
    case 'file':
      return isStreamUrl(record['url']) && record['url'].startsWith('https:') ? { kind: 'file', url: record['url'] } : null;
    case 'station': {
      const station = toStation(record['station']);
      return station ? { kind: 'station', station } : null;
    }
    default:
      return null;
  }
}

/** A message from a device, checked field by field. Anything unexpected is null and dropped. */
export function parseEvent(raw: unknown): RoomEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const id = (value: unknown) => text(value, 40);
  switch (m['type']) {
    case 'skip':
    case 'pause':
    case 'resume':
    case 'end':
    case 'mic-ask':
      return { type: m['type'] };
    case 'rename': {
      const name = text(m['name'], NAME_MAX);
      return name && name.trim().length >= NAME_MIN ? { type: 'rename', name } : null;
    }
    case 'add': {
      const what = source(m['source']);
      const title = text(m['title'], 300);
      const seconds = Number(m['seconds']);
      if (!what || title === null || !Number.isFinite(seconds) || seconds < 0) return null;
      const image = isStreamUrl(m['image']) && m['image'].startsWith('https:') && m['image'].length <= 500 ? m['image'] : undefined;
      return { type: 'add', source: what, title, seconds, ...(image ? { image } : {}) };
    }
    case 'remove':
    case 'failed': {
      const item = id(m['item']);
      return item ? { type: m['type'], item } : null;
    }
    case 'listening':
      return typeof m['on'] === 'boolean' ? { type: 'listening', on: m['on'] } : null;
    case 'settings': {
      const given = (typeof m['settings'] === 'object' && m['settings'] !== null ? m['settings'] : {}) as Record<string, unknown>;
      const settings: Partial<Settings> = {};
      if (given['adders'] === 'everyone' || given['adders'] === 'host') settings.adders = given['adders'];
      if (given['notes'] === 'host' || given['notes'] === 'selected' || given['notes'] === 'everyone') settings.notes = given['notes'];
      if (typeof given['approveNotes'] === 'boolean') settings.approveNotes = given['approveNotes'];
      if (typeof given['locked'] === 'boolean') settings.locked = given['locked'];
      const name = text(m['name'], ROOM_NAME_MAX);
      return { type: 'settings', settings, ...(name !== null ? { name } : {}) };
    }
    case 'handover':
    case 'kick': {
      const person = id(m['person']);
      return person ? { type: m['type'], person } : null;
    }
    case 'mic-allow': {
      const person = id(m['person']);
      return person && typeof m['allow'] === 'boolean' ? { type: 'mic-allow', person, allow: m['allow'] } : null;
    }
    case 'note-approve':
    case 'note-discard': {
      const note = id(m['id']);
      return note ? { type: m['type'], id: note } : null;
    }
    default:
      return null;
  }
}

/**
 * The room, as one function: (state, event, now) -> new state and what to do.
 * It has no clock and no network of its own, so every rule can be tested
 * plainly. The server calls it; it is the only place a room's rules live.
 */

import type { Station } from '../stations';
import {
  COLOURS,
  EMPTY_ROOM_MS,
  HEAD_START_MS,
  HISTORY,
  HOST_AWAY_MS,
  MAX_NOTES_WAITING,
  MAX_PEOPLE,
  MAX_SONG_SECONDS,
  MAX_WAITING,
  MAX_WAITING_EACH,
  NAME_MAX,
  NOTE_EVERY_MS,
  NOTE_GAP_SECONDS,
  NOTE_LEAD_MS,
  NOTE_SPACING_MS,
  ROOM_LIFE_MS,
  ROOM_NAME_MAX,
} from './limits';

export interface Settings {
  adders: 'everyone' | 'host';
  notes: 'host' | 'selected' | 'everyone';
  approveNotes: boolean;
  locked: boolean;
}

export type Source =
  | { kind: 'youtube'; id: string }
  | { kind: 'soundcloud'; url: string }
  | { kind: 'file'; url: string }
  | { kind: 'station'; station: Station };

export interface Item {
  id: string;
  source: Source;
  title: string;
  image?: string;
  /** Length in seconds; 0 for a station, which plays until skipped. */
  seconds: number;
  by: string;
  byName: string;
  turn: number;
  /** Public IDs of the people who voted to skip. */
  votes: string[];
  failed?: boolean;
}

export interface Person {
  /** Private to the room; never sent to other people. */
  device: string;
  id: string;
  name: string;
  colour: number;
  joinedAt: number;
  connections: number;
  listening: boolean;
  mayNote: boolean;
  askedMic: boolean;
  removed: boolean;
  lastNoteAt: number;
}

export interface Note {
  id: string;
  by: string;
  byName: string;
  colour: number;
  seconds: number;
  when: 'now' | 'after';
  /** approval: waiting for the host. waiting: for a gap or a resume. scheduled: has a moment to play. */
  state: 'approval' | 'waiting' | 'scheduled';
  playAt: number;
}

export interface RoomState {
  code: string;
  name: string;
  createdAt: number;
  /** The device that made the room. */
  host: string;
  /** A guest's device standing in while the host is away. */
  acting: string | null;
  hostAwayAt: number | null;
  settings: Settings;
  people: Person[];
  queue: Item[];
  current: Item | null;
  /** The moment position 0 of the current item is (or was) played. */
  startAt: number;
  /** Position in seconds where the host paused; null while playing. */
  pausedAt: number | null;
  history: Item[];
  notes: Note[];
  /** Voice notes are playing until this moment. */
  busyUntil: number;
  emptyAt: number | null;
  closed: boolean;
  seq: number;
}

export type RoomEvent =
  | { type: 'join'; name: string }
  | { type: 'leave' }
  | { type: 'rename'; name: string }
  | { type: 'add'; source: Source; title: string; image?: string; seconds: number }
  | { type: 'remove'; item: string }
  | { type: 'move'; item: string; to: number }
  | { type: 'skip' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'listening'; on: boolean }
  | { type: 'settings'; settings: Partial<Settings>; name?: string }
  | { type: 'handover'; person: string }
  | { type: 'kick'; person: string }
  | { type: 'end' }
  | { type: 'mic-ask' }
  | { type: 'mic-allow'; person: string; allow: boolean }
  | { type: 'note'; id: string; seconds: number; when: 'now' | 'after' }
  | { type: 'note-approve'; id: string }
  | { type: 'note-discard'; id: string }
  | { type: 'failed'; item: string }
  | { type: 'wake' };

/** Why an event was refused; the app turns each into the plan's words. */
export type Refusal =
  | 'ended'
  | 'locked'
  | 'full'
  | 'removed'
  | 'not-here'
  | 'not-allowed'
  | 'own-limit'
  | 'queue-full'
  | 'too-long'
  | 'live'
  | 'duplicate'
  | 'note-rate'
  | 'note-full'
  | 'note-length';

export interface Outcome {
  state: RoomState;
  /** Set when the event was refused; the state is then unchanged. */
  refused?: Refusal;
  /** A line everyone in the room should see, such as a change of host. */
  notice?: string;
  /** Voice notes whose audio can now be deleted. */
  dropped: string[];
  /** Devices to disconnect: a removed person, or everyone when the room ends. */
  disconnect: string[];
}

export function createRoom(code: string, host: string, name: string, now: number): RoomState {
  return {
    code,
    name: clean(name, ROOM_NAME_MAX),
    createdAt: now,
    host,
    acting: null,
    hostAwayAt: null,
    settings: { adders: 'everyone', notes: 'selected', approveNotes: false, locked: false },
    people: [],
    queue: [],
    current: null,
    startAt: 0,
    pausedAt: null,
    history: [],
    notes: [],
    busyUntil: 0,
    emptyAt: now,
    closed: false,
    seq: 0,
  };
}

const clean = (text: string, limit: number) =>
  Array.from(text, (char) => (/\p{Cc}/u.test(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const present = (person: Person) => person.connections > 0 && !person.removed;

/** The device that holds the host's powers right now. */
export function hostDevice(state: RoomState): string {
  const owner = state.people.find((person) => person.device === state.host);
  return owner && present(owner) ? state.host : (state.acting ?? state.host);
}

/** A stable key for "the same song", used to refuse duplicates. */
export function sourceKey(source: Source): string {
  switch (source.kind) {
    case 'youtube':
      return `youtube:${source.id}`;
    case 'station':
      return `station:${source.station.stationuuid ?? source.station.url}`;
    default:
      return `${source.kind}:${source.url}`;
  }
}

/** Seconds into the current item at `now`; negative during its head start. */
export function position(state: Pick<RoomState, 'startAt' | 'pausedAt'>, now: number): number {
  return state.pausedAt ?? (now - state.startAt) / 1000;
}

/** Where a new item goes: everyone's first waiting item before anyone's second. */
function insertByTurn(queue: Item[], item: Item): void {
  const index = queue.findIndex((waiting) => waiting.turn > item.turn);
  queue.splice(index < 0 ? queue.length : index, 0, item);
}

/** Give each waiting voice note its moment, one after another, starting no earlier than `from`. */
function scheduleNotes(state: RoomState, from: number, which: (note: Note) => boolean): void {
  let at = Math.max(from + NOTE_LEAD_MS, state.busyUntil + NOTE_SPACING_MS);
  for (const note of state.notes) {
    if (note.state !== 'waiting' || !which(note)) continue;
    note.state = 'scheduled';
    note.playAt = at;
    at += note.seconds * 1000 + NOTE_SPACING_MS;
    state.busyUntil = note.playAt + note.seconds * 1000;
  }
}

/** Finish the current item and start the next, after any voice notes waiting for the gap. */
function advance(state: RoomState, now: number): void {
  if (state.current) state.history = [state.current, ...state.history].slice(0, HISTORY);
  state.current = state.queue.shift() ?? null;
  state.pausedAt = null;
  scheduleNotes(state, now - NOTE_LEAD_MS + NOTE_SPACING_MS, () => true);
  state.startAt = Math.max(now, state.busyUntil) + HEAD_START_MS;
}

/** When the room next needs to act by itself, or null if only a person can change it. */
export function wakeAt(state: RoomState): number | null {
  if (state.closed) return null;
  const moments = [state.createdAt + ROOM_LIFE_MS];
  if (state.emptyAt !== null) moments.push(state.emptyAt + EMPTY_ROOM_MS);
  if (state.hostAwayAt !== null && state.acting === null) moments.push(state.hostAwayAt + HOST_AWAY_MS);
  if (state.current && state.current.seconds > 0 && state.pausedAt === null) {
    moments.push(state.startAt + state.current.seconds * 1000 + 400);
  }
  for (const note of state.notes) {
    if (note.state === 'scheduled') moments.push(note.playAt + note.seconds * 1000 + 200);
  }
  return Math.min(...moments);
}

export function apply(before: RoomState, device: string, event: RoomEvent, now: number): Outcome {
  const state = structuredClone(before);
  const outcome: Outcome = { state, dropped: [], disconnect: [] };
  const refuse = (refused: Refusal): Outcome => ({ state: before, refused, dropped: [], disconnect: [] });
  if (state.closed) return refuse('ended');

  const me = state.people.find((person) => person.device === device);
  const isHost = device === hostDevice(state);
  const here = () => state.people.filter(present);

  if (event.type === 'wake') {
    if (now >= state.createdAt + ROOM_LIFE_MS || (state.emptyAt !== null && now >= state.emptyAt + EMPTY_ROOM_MS)) {
      return close(outcome);
    }
    const finished = state.notes.filter((note) => note.state === 'scheduled' && now >= note.playAt + note.seconds * 1000);
    outcome.dropped = finished.map((note) => note.id);
    state.notes = state.notes.filter((note) => !finished.includes(note));
    if (state.hostAwayAt !== null && state.acting === null && now >= state.hostAwayAt + HOST_AWAY_MS) {
      const next = here().sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        state.acting = next.device;
        outcome.notice = `${next.name} is now the host`;
      }
    }
    const current = state.current;
    if (current && current.seconds > 0 && state.pausedAt === null && now >= state.startAt + current.seconds * 1000) {
      advance(state, now);
    }
    return outcome;
  }

  if (event.type === 'join') {
    if (me?.removed) return refuse('removed');
    if (me) {
      me.connections++;
    } else {
      if (state.settings.locked && device !== state.host) return refuse('locked');
      if (here().length >= MAX_PEOPLE) return refuse('full');
      state.seq++;
      state.people.push({
        device,
        id: `p${state.seq}`,
        name: uniqueName(state, clean(event.name, NAME_MAX) || 'Guest'),
        colour: (state.seq - 1) % COLOURS,
        joinedAt: now,
        connections: 1,
        // The host's device plays by default; a guest chooses to.
        listening: device === state.host,
        mayNote: false,
        askedMic: false,
        removed: false,
        lastNoteAt: 0,
      });
    }
    state.emptyAt = null;
    if (device === state.host) {
      const standIn = state.acting;
      state.hostAwayAt = null;
      state.acting = null;
      if (standIn) outcome.notice = `${state.people.find((person) => person.device === device)!.name} is back as host`;
    }
    return outcome;
  }

  if (!me || me.removed) return refuse('not-here');

  switch (event.type) {
    case 'leave': {
      me.connections = Math.max(0, me.connections - 1);
      if (me.connections === 0) {
        me.listening = false;
        if (device === state.host) state.hostAwayAt = now;
        if (device === state.acting) {
          state.acting = null;
          state.hostAwayAt = now - HOST_AWAY_MS;
        }
        if (here().length === 0) state.emptyAt = now;
      }
      return outcome;
    }

    case 'rename': {
      const name = clean(event.name, NAME_MAX);
      if (name.length >= 2 && name !== me.name) me.name = uniqueName(state, name, me);
      return outcome;
    }

    case 'add': {
      if (state.settings.adders === 'host' && !isHost) return refuse('not-allowed');
      if (state.queue.filter((item) => item.by === me.id).length >= MAX_WAITING_EACH) return refuse('own-limit');
      if (state.queue.length >= MAX_WAITING) return refuse('queue-full');
      const station = event.source.kind === 'station';
      if (!station && event.seconds <= 0) return refuse('live');
      if (!station && event.seconds > MAX_SONG_SECONDS) return refuse('too-long');
      const key = sourceKey(event.source);
      if ([state.current, ...state.queue].some((item) => item && sourceKey(item.source) === key)) return refuse('duplicate');
      state.seq++;
      const item: Item = {
        id: `i${state.seq}`,
        source: event.source,
        title: clean(event.title, 200) || 'Untitled',
        seconds: station ? 0 : Math.round(event.seconds),
        by: me.id,
        byName: me.name,
        turn: state.queue.filter((waiting) => waiting.by === me.id).length + 1,
        votes: [],
      };
      if (event.image) item.image = event.image;
      insertByTurn(state.queue, item);
      if (!state.current) advance(state, now);
      return outcome;
    }

    case 'remove': {
      const item = state.queue.find((waiting) => waiting.id === event.item);
      if (!item) return outcome;
      if (item.by !== me.id && !isHost) return refuse('not-allowed');
      state.queue = state.queue.filter((waiting) => waiting !== item);
      return outcome;
    }

    case 'move': {
      if (!isHost) return refuse('not-allowed');
      const from = state.queue.findIndex((waiting) => waiting.id === event.item);
      if (from < 0) return outcome;
      const [item] = state.queue.splice(from, 1);
      state.queue.splice(Math.max(0, Math.min(state.queue.length, event.to)), 0, item!);
      return outcome;
    }

    case 'skip': {
      const current = state.current;
      if (!current) return outcome;
      if (isHost) {
        advance(state, now);
        return outcome;
      }
      if (!current.votes.includes(me.id)) current.votes.push(me.id);
      // More than half the room, and never on one person's say.
      if (current.votes.length >= 2 && current.votes.length > here().length / 2) advance(state, now);
      return outcome;
    }

    case 'failed': {
      // Only the host's device decides that an item cannot play at all.
      if (isHost && state.current?.id === event.item) {
        state.current.failed = true;
        advance(state, now);
      }
      return outcome;
    }

    case 'pause': {
      if (!isHost) return refuse('not-allowed');
      if (state.current && state.pausedAt === null) state.pausedAt = Math.max(0, position(state, now));
      return outcome;
    }

    case 'resume': {
      if (!isHost) return refuse('not-allowed');
      if (state.current && state.pausedAt !== null) {
        state.startAt = now - state.pausedAt * 1000;
        state.pausedAt = null;
        scheduleNotes(state, now, (note) => note.when === 'now');
      }
      return outcome;
    }

    case 'listening': {
      me.listening = event.on;
      return outcome;
    }

    case 'settings': {
      if (!isHost) return refuse('not-allowed');
      state.settings = { ...state.settings, ...event.settings };
      if (event.name !== undefined) state.name = clean(event.name, ROOM_NAME_MAX) || state.name;
      return outcome;
    }

    case 'handover': {
      if (!isHost) return refuse('not-allowed');
      const next = state.people.find((person) => person.id === event.person && present(person));
      if (!next) return outcome;
      state.host = next.device;
      state.acting = null;
      state.hostAwayAt = null;
      outcome.notice = `${next.name} is now the host`;
      return outcome;
    }

    case 'kick': {
      if (!isHost) return refuse('not-allowed');
      const target = state.people.find((person) => person.id === event.person);
      if (!target || target.device === device) return outcome;
      target.removed = true;
      target.connections = 0;
      target.listening = false;
      state.queue = state.queue.filter((item) => item.by !== target.id);
      outcome.disconnect = [target.device];
      return outcome;
    }

    case 'end': {
      if (!isHost) return refuse('not-allowed');
      return close(outcome);
    }

    case 'mic-ask': {
      if (state.settings.notes === 'selected' && !me.mayNote) me.askedMic = true;
      return outcome;
    }

    case 'mic-allow': {
      if (!isHost) return refuse('not-allowed');
      const target = state.people.find((person) => person.id === event.person);
      if (target) {
        target.mayNote = event.allow;
        target.askedMic = false;
      }
      return outcome;
    }

    case 'note': {
      if (!canSendNotes(state, me, isHost)) return refuse('not-allowed');
      if (event.seconds < 1 || event.seconds > 21) return refuse('note-length');
      if (now - me.lastNoteAt < NOTE_EVERY_MS) return refuse('note-rate');
      if (state.notes.length >= MAX_NOTES_WAITING) return refuse('note-full');
      me.lastNoteAt = now;
      const note: Note = {
        id: event.id,
        by: me.id,
        byName: me.name,
        colour: me.colour,
        seconds: event.seconds,
        when: event.when,
        state: state.settings.approveNotes && !isHost ? 'approval' : 'waiting',
        playAt: 0,
      };
      state.notes.push(note);
      if (note.state === 'waiting') placeNote(state, note, now);
      return outcome;
    }

    case 'note-approve': {
      if (!isHost) return refuse('not-allowed');
      const note = state.notes.find((waiting) => waiting.id === event.id && waiting.state === 'approval');
      if (note) {
        note.state = 'waiting';
        placeNote(state, note, now);
      }
      return outcome;
    }

    case 'note-discard': {
      const note = state.notes.find((waiting) => waiting.id === event.id && waiting.state !== 'scheduled');
      if (!note) return outcome;
      if (!isHost && note.by !== me.id) return refuse('not-allowed');
      state.notes = state.notes.filter((waiting) => waiting !== note);
      outcome.dropped = [note.id];
      return outcome;
    }
  }
}

export function canSendNotes(state: RoomState, person: Person, isHost: boolean): boolean {
  if (isHost || state.settings.notes === 'everyone') return true;
  return state.settings.notes === 'selected' && person.mayNote;
}

/** Decide when an approved note plays: now, in the gap after this item, or once the room resumes. */
function placeNote(state: RoomState, note: Note, now: number): void {
  const current = state.current;
  if (!current) {
    scheduleNotes(state, now, (waiting) => waiting === note);
    return;
  }
  if (state.pausedAt !== null || note.when === 'after') return;
  const left = current.seconds > 0 ? current.seconds - position(state, now) : Infinity;
  // Do not talk over a song's last seconds; the gap is moments away.
  if (left < NOTE_GAP_SECONDS) return;
  scheduleNotes(state, now, (waiting) => waiting === note);
}

function uniqueName(state: RoomState, name: string, self?: Person): string {
  const taken = new Set(state.people.filter((person) => person !== self && !person.removed).map((person) => person.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}

function close(outcome: Outcome): Outcome {
  const { state } = outcome;
  state.closed = true;
  outcome.dropped = state.notes.map((note) => note.id);
  outcome.disconnect = state.people.filter(present).map((person) => person.device);
  state.notes = [];
  state.queue = [];
  state.current = null;
  return outcome;
}

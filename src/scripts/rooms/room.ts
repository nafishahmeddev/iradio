/** The Rooms screens: lobby, room, queue, synced playback, voice notes and the sheets. */

import qrcode from 'qrcode-generator';

import { duration } from '../../lib/format';
import { tidyCode } from '../../lib/rooms/code';
import { correct, envelope, glide, learnLead } from '../../lib/rooms/follow';
import { parseLink } from '../../lib/rooms/links';
import {
  DUCK_LEVEL,
  FADE_IN_SECONDS,
  FADE_OUT_SECONDS,
  GLIDE_MS,
  DRIFT_ALLOWED_SECONDS,
  MAX_SONG_SECONDS,
  MAX_WAITING,
  MAX_WAITING_EACH,
  NAME_MIN,
  NOTE_MIN_SECONDS,
} from '../../lib/rooms/limits';
import type { ItemView, RoomView, ServerMessage } from '../../lib/rooms/protocol';
import type { Refusal, Source } from '../../lib/rooms/room';
import type { Station } from '../../lib/stations';
import { now, startClock, stopClock } from './clock';
import { Connection } from './connection';
import { createPlayers, readDetails, type Details, type RoomPlayer } from './players';
import { canRecord, record, type Recording } from './recorder';

export interface RoomsHost {
  toast: (message: string) => void;
  /** Called when a room is entered, so the radio stops. */
  entered: () => void;
  /** Called whenever being in a room starts or stops. */
  changed: (inRoom: boolean) => void;
}

export interface Rooms {
  /** Show the Rooms view: the room if in one, otherwise the lobby. */
  show: () => void;
  inRoom: () => boolean;
  code: () => string | null;
  /** Add a radio station to the room's queue. */
  addStation: (station: Station) => void;
  /** True while this device is playing the room's audio. */
  sounding: () => boolean;
  /** The artwork disc the backdrop's rings surround while in a room; null in the lobby. */
  anchor: () => HTMLElement | null;
  /** The people to draw as lights in the backdrop: a hue each, and how bright. */
  orbs: () => Array<{ hue: number; energy: number }>;
}

const HUES = [30, 200, 280, 140, 340, 50, 170, 250];
/** A few quiet lights for the lobby: the room you are about to make. */
const LOBBY_ORBS = [30, 280, 200, 340].map((hue) => ({ hue, energy: 0.1 }));

/** The plan's words for each reason the room can refuse something. */
const REFUSALS: Record<Refusal | 'none' | 'unavailable', string> = {
  unavailable: 'Rooms are unavailable right now. Please try again later.',
  ended: 'This room has ended',
  locked: 'This room is locked',
  full: 'This room is full',
  removed: 'You were removed from this room',
  none: 'No room with that code',
  'not-here': 'You are no longer in this room',
  'not-allowed': 'Only the host can do that',
  'own-limit': `You have ${MAX_WAITING_EACH} songs waiting`,
  'queue-full': 'The queue is full',
  'too-long': 'Songs can be up to 15 minutes',
  live: 'Live videos cannot be queued',
  duplicate: 'That song is already in the queue',
  'note-rate': 'You can send one voice note a minute',
  'note-full': 'Too many voice notes are waiting',
  'note-length': 'Hold to record',
};

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

function stored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Without storage the visit still works; it just is not remembered.
  }
}

/** This device's private ID, made once. It is what lets a host come back as host. */
function deviceId(): string {
  let id = stored('iradio.device');
  if (!/^[\w-]{16,64}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    store('iradio.device', id);
  }
  return id;
}

function tint(holder: HTMLElement, label: Element, name: string, colour?: number, image?: string): void {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  holder.style.setProperty('--hue', String(colour === undefined ? hash : HUES[colour % HUES.length]));
  label.textContent = (Array.from(name).find((char) => /[\p{L}\p{N}]/u.test(char)) ?? '♪').toUpperCase();
  const picture = holder.querySelector('img');
  if (!picture) return;
  picture.removeAttribute('data-loaded');
  if (image) picture.src = image;
  else picture.removeAttribute('src');
}

export function initRooms(host: RoomsHost): Rooms {
  const view = {
    rooms: el('rooms'),
    lobby: el('lobby'),
    room: el('room'),
    joinForm: el<HTMLFormElement>('join-form'),
    joinCode: el<HTMLInputElement>('join-code'),
    joinButton: el<HTMLButtonElement>('join-button'),
    lobbyProblem: el('lobby-problem'),
    name: el('room-name'),
    code: el('room-code'),
    peopleCount: el('people-count'),
    faces: el('people-faces'),
    settingsButton: el('settings-button'),
    banner: el('room-banner'),
    players: el('players'),
    frameArt: el('frame-art'),
    frameMono: el('frame-mono'),
    badge: el('room-badge'),
    state: el('room-state'),
    time: el('room-time'),
    title: el('room-title'),
    by: el('room-by'),
    byFace: el('room-by-face'),
    queueCount: el('queue-count'),
    progress: el('room-progress'),
    speaking: el('speaking'),
    speakingArt: el('speaking-art'),
    speakingMono: el('speaking-mono'),
    speakingText: el('speaking-text'),
    speakingPlay: el<HTMLButtonElement>('speaking-play'),
    listen: el<HTMLButtonElement>('listen'),
    pause: el<HTMLButtonElement>('room-pause'),
    skip: el<HTMLButtonElement>('skip'),
    mic: el<HTMLButtonElement>('mic'),
    micLabel: el('mic-label'),
    volume: el<HTMLInputElement>('room-volume'),
    volumeValue: el('room-volume-value'),
    addForm: el<HTMLFormElement>('add-form'),
    addLink: el<HTMLInputElement>('add-link'),
    addPreview: el('add-preview'),
    addArt: el('add-art'),
    addMono: el('add-mono'),
    addTitle: el('add-title'),
    addMeta: el('add-meta'),
    addButton: el<HTMLButtonElement>('add-button'),
    addProblem: el('add-problem'),
    approvals: el('approvals'),
    items: el('items'),
    queueEmpty: el('queue-empty'),
    itemTemplate: el<HTMLTemplateElement>('item-template'),
    personTemplate: el<HTMLTemplateElement>('person-template'),
    approvalTemplate: el<HTMLTemplateElement>('approval-template'),
    nameDialog: el<HTMLDialogElement>('name-dialog'),
    nameForm: el<HTMLFormElement>('name-form'),
    nameInput: el<HTMLInputElement>('name-input'),
    nameContinue: el<HTMLButtonElement>('name-continue'),
    shareDialog: el<HTMLDialogElement>('share-dialog'),
    shareCode: el('share-code'),
    shareQr: el('share-qr'),
    shareCopy: el<HTMLButtonElement>('share-copy'),
    shareCopyLabel: el('share-copy-label'),
    shareNative: el<HTMLButtonElement>('share-native'),
    peopleDialog: el<HTMLDialogElement>('people-dialog'),
    people: el('people'),
    settingsDialog: el<HTMLDialogElement>('room-settings-dialog'),
    settingName: el<HTMLInputElement>('setting-name'),
    endDialog: el<HTMLDialogElement>('end-dialog'),
    noteDialog: el<HTMLDialogElement>('note-dialog'),
    noteHint: el('note-hint'),
    noteRecord: el<HTMLButtonElement>('note-record'),
    noteTime: el('note-time'),
    noteWhen: el('note-when'),
    noteActions: el('note-actions'),
    noteProblem: el('note-problem'),
  };

  const device = deviceId();
  let connection: Connection | null = null;
  let room: RoomView | null = null;
  let code: string | null = null;
  let status: 'connected' | 'reconnecting' = 'connected';

  // ------------------------------------------------------------------ playback on this device

  let listening = false;
  /** Sound will not start without another tap (a phone's rule), so the button asks for one. */
  let blocked = false;
  /** This device cannot play the current item at all. */
  let unavailable = '';
  let level = Number(stored('iradio.room-volume') || 70) / 100;
  let duck = 1;
  let player: RoomPlayer | null = null;
  let loaded = '';
  let phase: 'idle' | 'loading' | 'armed' | 'paused' | 'playing' = 'idle';
  let startedAt = 0;
  let checkedAt = 0;
  /** How long this device's jumps take to land, learned as it plays; kept per kind of player. */
  const leads = new Map<RoomPlayer, number>();
  /** No judging the position before this moment: a jump is still landing. */
  let settleUntil = 0;
  let jumped = false;
  let checking = false;

  const players = createPlayers({
    failed: (reason) => {
      const item = room?.current;
      if (!item || item.id !== loaded) return;
      // Only the host's device decides an item cannot play for anyone.
      if (room?.you.host) connection?.send({ type: 'failed', item: item.id, reason });
      else {
        unavailable = item.id;
        render();
      }
    },
  });

  /**
   * Loudness is four things multiplied: this device's volume, the dip under a
   * voice note, the song's own fade in and out, and a gate that stays shut
   * until a device joining mid-song is in step. One mixer glides the player
   * towards that product, so no change of loudness is ever abrupt.
   */
  let edge = 0;
  let gate = 1;
  let applied = 0;
  let mixedAt = performance.now();
  let mixedFor: RoomPlayer | null = null;
  window.setInterval(() => {
    const clock = performance.now();
    const target = listening && player ? level * duck * edge * gate : 0;
    const next = glide(applied, target, clock - mixedAt, GLIDE_MS);
    mixedAt = clock;
    if (!player || (next === applied && mixedFor === player)) return;
    applied = next;
    mixedFor = player;
    player.volume(applied);
  }, 40);

  /** Set the dip under a voice note; the mixer carries it there smoothly. */
  const fade = (to: number): void => {
    duck = to;
  };

  function silence(): void {
    player?.pause();
    phase = 'idle';
    loaded = '';
  }

  /** Put a player on the page. It stays out of sight; the artwork is what people look at. */
  function showPicture(picture: HTMLElement | null): void {
    // A player already in place must be left exactly where it is: taking an
    // embedded player out of the page and putting it back reloads it from scratch.
    if (picture && picture.parentElement === view.players) return;
    view.players.replaceChildren(...(picture ? [picture] : []));
  }

  /** Bring this device's player to where the room's timeline says it should be. Runs four times a second. */
  function follow(): void {
    const item = room?.current;
    if (!listening || !item || !room) {
      if (phase !== 'idle') silence();
      return;
    }
    if (item.id !== loaded) {
      player?.pause();
      loaded = item.id;
      phase = 'loading';
      unavailable = '';
      blocked = false;
      const next = (player = players(item.source.kind));
      showPicture(next.picture);
      next.load(item.source).then(
        () => item.id === loaded && (phase = 'idle'),
        () => item.id === loaded && room?.you.host && connection?.send({ type: 'failed', item: item.id, reason: 'load' }),
      );
      return;
    }
    if (phase === 'loading' || !player || unavailable) return;

    const wanted = room.pausedAt ?? (now() - room.startAt) / 1000;
    if (room.pausedAt !== null) {
      if (phase !== 'paused') {
        player.pause();
        if (item.seconds > 0) player.seek(wanted);
        phase = 'paused';
      }
      return;
    }
    edge = envelope(wanted, item.seconds, FADE_IN_SECONDS, FADE_OUT_SECONDS);
    if (wanted < 0) {
      phase = 'armed';
      return;
    }
    if (item.seconds > 0 && wanted > item.seconds) return;
    if (phase !== 'playing') {
      // A song at its beginning simply starts. One already under way is jumped to,
      // and stays silent until it has landed, then fades in.
      const joining = wanted > FADE_IN_SECONDS;
      if (item.seconds > 0 && joining) player.seek(wanted + (leads.get(player) ?? 0));
      gate = joining ? 0 : 1;
      player.play();
      phase = 'playing';
      startedAt = performance.now();
      checkedAt = 0;
      jumped = item.seconds > 0 && joining;
      // The first reading has nothing before it to agree with; do not let an old one stand in.
      drift = 0;
      settleUntil = performance.now() + 1200;
      return;
    }
    const clock = performance.now();
    // Asked to play some seconds ago and still silent: a phone is waiting for a tap.
    if (clock - startedAt > 4000 && blocked !== !player.playing()) {
      blocked = !player.playing();
      render();
    }
    // In step or not, do not keep a listener in silence: open the gate after a few seconds regardless.
    if (gate === 0 && clock - startedAt > 6000) gate = 1;
    // A live station has no position to keep to. Otherwise judge the position once a
    // second, but never while the player is still loading or a jump is landing.
    if (item.seconds === 0 || checking || clock < settleUntil || clock - checkedAt < 1000 || !player.settled()) return;
    checkedAt = clock;
    checking = true;
    const current = player;
    void current.position().then((actual) => {
      checking = false;
      if (current !== player || phase !== 'playing' || !room || room.pausedAt !== null || !current.settled() || !Number.isFinite(actual)) return;
      const target = (now() - room.startAt) / 1000;
      const error = actual - target;
      if (Math.abs(error) < DRIFT_ALLOWED_SECONDS) gate = 1;
      // The first reading after a jump shows how far off the jump landed: learn from it.
      if (jumped) {
        jumped = false;
        leads.set(current, learnLead(leads.get(current) ?? 0, error));
      }
      const before = drift;
      drift = error;
      const fix = correct(before, error, target, leads.get(current) ?? 0, DRIFT_ALLOWED_SECONDS);
      if (fix.kind === 'none') return;
      current.seek(fix.to);
      jumped = true;
      settleUntil = performance.now() + 1200;
    });
  }

  /** The last measured distance from the timeline, in seconds; shown nowhere, read by tests. */
  let drift = 0;
  Object.defineProperty(window, '__roomDrift', { get: () => drift, configurable: true });

  // ------------------------------------------------------------------ voice notes on this device

  const noteAudio = new Audio();
  const notes = new Map<string, { blob: Promise<string>; timers: number[] }>();
  let speakingNote = '';
  /** The name of whoever's voice note is playing now. */
  let speaker = '';

  function scheduleNotes(): void {
    if (!room || !code) return;
    for (const note of room.playing) {
      if (notes.has(note.id)) continue;
      const blob = fetch(`/api/rooms/${code}/notes/${note.id}`)
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('gone'))))
        .then((audio) => URL.createObjectURL(audio));
      blob.catch(() => undefined);
      const begin = Math.max(0, note.playAt - now());
      const finish = begin + note.seconds * 1000;
      const start = window.setTimeout(() => {
        speakingNote = note.id;
        speaker = note.byName;
        tint(view.speakingArt, view.speakingMono, note.byName, note.colour);
        view.speakingText.textContent = `${note.byName} is speaking`;
        view.speaking.hidden = false;
        view.speakingPlay.hidden = listening;
        if (listening) void playNote(note.id);
      }, begin);
      const end = window.setTimeout(() => {
        if (speakingNote === note.id) {
          view.speaking.hidden = true;
          speaker = '';
        }
        void blob.then((url) => URL.revokeObjectURL(url), () => undefined);
      }, finish + 400);
      notes.set(note.id, { blob, timers: [start, end] });
    }
  }

  async function playNote(id: string): Promise<void> {
    const entry = notes.get(id);
    if (!entry) return;
    try {
      noteAudio.src = await entry.blob;
      fade(DUCK_LEVEL);
      noteAudio.onended = noteAudio.onerror = () => fade(1);
      await noteAudio.play();
    } catch {
      fade(1);
    }
  }

  view.speakingPlay.addEventListener('click', () => void playNote(speakingNote));

  // ------------------------------------------------------------------ joining and leaving

  function showLobby(problem = ''): void {
    view.lobby.hidden = false;
    view.room.hidden = true;
    view.lobbyProblem.textContent = problem;
  }

  /** Ask for a name the first time, then carry on. */
  function withName(then: (name: string) => void): void {
    const name = stored('iradio.name');
    if (name.trim().length >= NAME_MIN) return then(name);
    view.nameInput.value = '';
    view.nameContinue.disabled = true;
    view.nameForm.onsubmit = () => {
      const chosen = view.nameInput.value.trim();
      if (chosen.length < NAME_MIN) return;
      store('iradio.name', chosen);
      then(chosen);
    };
    view.nameDialog.showModal();
  }

  function leave(problem = ''): void {
    const was = code !== null;
    connection?.close();
    connection = null;
    room = null;
    code = null;
    listening = false;
    silence();
    showPicture(null);
    stopClock();
    for (const { timers } of notes.values()) timers.forEach((timer) => window.clearTimeout(timer));
    notes.clear();
    view.speaking.hidden = true;
    store('iradio.room', '');
    for (const dialog of view.rooms.parentElement!.querySelectorAll('dialog[open]')) (dialog as HTMLDialogElement).close();
    if (window.location.pathname.startsWith('/r/')) window.history.replaceState(null, '', '/');
    showLobby(problem);
    if (was) host.changed(false);
  }

  function enter(target: string): void {
    withName((name) => {
      connection?.close();
      code = target;
      room = null;
      status = 'connected';
      view.lobbyProblem.textContent = '';
      view.joinButton.disabled = true;
      void startClock();
      connection = new Connection(target, device, name, {
        message: onMessage,
        status: (next) => {
          status = next;
          render();
        },
        refused: (reason) => leave(REFUSALS[reason]),
      });
    });
  }

  function onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'room': {
        const first = room === null;
        room = message.room;
        if (first) {
          view.lobby.hidden = true;
          view.room.hidden = false;
          store('iradio.room', room.code);
          if (window.location.pathname !== `/r/${room.code}`) window.history.replaceState(null, '', `/r/${room.code}`);
          host.entered();
          host.changed(true);
          // The room assumes a host's device is listening; say what is true until a tap makes it so.
          connection?.send({ type: 'listening', on: listening });
        }
        scheduleNotes();
        render();
        return;
      }
      case 'notice':
        host.toast(message.text);
        return;
      case 'refused':
        host.toast(REFUSALS[message.reason]);
        return;
      case 'gone':
        leave(REFUSALS[message.reason]);
        return;
    }
  }

  async function create(): Promise<void> {
    withName(async (name) => {
      view.lobbyProblem.textContent = '';
      try {
        const params = new URLSearchParams({ device, name: `${name}'s room` });
        const response = await fetch(`/api/rooms?${params}`, { method: 'POST' });
        const body = (await response.json()) as { code?: string };
        if (response.status >= 500) {
          view.lobbyProblem.textContent = REFUSALS.unavailable;
          return;
        }
        if (!response.ok || !body.code) throw new Error('failed');
        enter(body.code);
      } catch {
        view.lobbyProblem.textContent = 'Could not create a room. Check your connection.';
      }
    });
  }

  // ------------------------------------------------------------------ rendering

  let itemsKey = '';
  let peopleKey = '';
  let approvalsKey = '';

  function itemRow(item: ItemView): HTMLElement {
    const row = (view.itemTemplate.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    row.dataset['id'] = item.id;
    tint(row.querySelector<HTMLElement>('.logo')!, row.querySelector('.item-mono')!, item.title, undefined, item.image ?? stationLogo(item.source));
    row.querySelector('.item-title')!.textContent = item.title;
    // Who added it, in their own colour.
    const adder = room!.people.find((person) => person.id === item.by);
    row.querySelector<HTMLElement>('.avatar')!.style.setProperty('--hue', String(HUES[(adder?.colour ?? 0) % HUES.length]));
    row.querySelector('.item-who')!.textContent = item.by === room!.you.id ? 'You' : item.byName;
    row.querySelector('.item-length')!.textContent = item.seconds ? duration(item.seconds) : 'Station';
    // Only the person who added it, or the host, may delete it.
    row.querySelector<HTMLElement>('[data-item="remove"]')!.hidden = !(item.by === room!.you.id || room!.you.host);
    return row;
  }

  const stationLogo = (source: Source) => (source.kind === 'station' ? source.station.logo : undefined);

  function render(): void {
    if (!room) return;
    const { you, current } = room;
    const here = room.people.filter((person) => person.here);

    view.name.textContent = room.name;
    view.code.textContent = room.code;
    view.peopleCount.textContent = String(here.length);
    // Up to four faces in the header; the count says how many there are in all.
    const faces = here.slice(0, 4).map((person) => person.colour).join(',');
    if (view.faces.dataset['shown'] !== faces) {
      view.faces.dataset['shown'] = faces;
      const figure = view.personTemplate.content.querySelector('.avatar')!;
      view.faces.replaceChildren(
        ...here.slice(0, 4).map((person) => {
          const face = figure.cloneNode(true) as HTMLElement;
          face.style.setProperty('--hue', String(HUES[person.colour % HUES.length]));
          return face;
        }),
      );
    }
    view.settingsButton.hidden = !you.host;
    view.banner.hidden = status === 'connected';
    view.banner.textContent = 'Reconnecting…';

    // Now playing
    const paused = room.pausedAt !== null;
    const state = !current ? 'empty' : paused ? 'paused' : now() < room.startAt ? 'starting' : 'playing';
    view.badge.dataset['state'] = state;
    const hostName = room.people.find((person) => person.host)?.name ?? 'the host';
    view.state.textContent = { empty: 'Ready', starting: 'Up next', playing: 'Playing', paused: `Paused by ${hostName}` }[state];
    view.title.textContent = current ? current.title : 'Drop the first song';
    view.by.textContent = !current
      ? 'Paste a link or add a station.'
      : unavailable === current.id
        ? 'Not available on this device'
        : !listening
          ? `Added by ${current.byName}  ·  Not playing on this device`
          : `Added by ${current.byName}`;
    view.byFace.hidden = !current;
    const adder = current && room.people.find((person) => person.id === current.by);
    if (adder) view.byFace.style.setProperty('--hue', String(HUES[adder.colour % HUES.length]));
    view.queueCount.textContent = room.queue.length ? `${room.queue.length} waiting` : '';
    if (current) tint(view.frameArt, view.frameMono, current.title, undefined, current.image ?? stationLogo(current.source));
    else tint(view.frameArt, view.frameMono, room.name);

    // Controls
    view.listen.setAttribute('aria-pressed', String(listening && !blocked));
    // Some phones only let a video start from a tap on the video itself.
    const tapVideo = blocked && current !== null && (current.source.kind === 'youtube' || current.source.kind === 'soundcloud');
    view.players.toggleAttribute('data-reveal', tapVideo);
    // A YouTube video plays in view, in the disc, for as long as this device is playing it.
    view.players.toggleAttribute('data-show', listening && current?.source.kind === 'youtube' && unavailable !== current.id);
    view.listen.textContent = !listening ? 'Listen here' : tapVideo ? 'Tap the video to start sound' : blocked ? 'Tap to start sound' : 'Stop listening';
    view.pause.hidden = !you.host;
    view.pause.disabled = !current;
    view.pause.dataset['state'] = paused ? 'paused' : 'playing';
    view.pause.setAttribute('aria-label', paused ? 'Resume for everyone' : 'Pause for everyone');
    view.skip.disabled = !current;
    view.skip.textContent = you.host || !current ? 'Skip' : `Skip · ${current.votes} of ${here.length}`;
    view.skip.setAttribute('aria-pressed', String(Boolean(current?.voted)));

    const mode = room.settings.notes;
    const wait = Math.ceil((you.nextNoteAt - now()) / 1000);
    view.mic.hidden = !you.canNote && mode === 'host';
    view.mic.disabled = (you.canNote && wait > 0) || (!you.canNote && you.askedMic) || (you.canNote && !canRecord());
    view.micLabel.textContent = you.canNote
      ? wait > 0
        ? `In ${wait} s`
        : 'Voice note'
      : you.askedMic
        ? `Waiting for ${hostName}`
        : 'Ask for the mic';
    view.mic.title = you.canNote && !canRecord() ? 'This browser cannot record' : you.canNote && wait > 0 ? `You can send another in ${wait} s` : '';

    view.volume.value = String(Math.round(level * 100));
    view.volume.style.setProperty('--fill', `${Math.round(level * 100)}%`);
    view.volumeValue.textContent = `${Math.round(level * 100)}%`;

    // Adding
    const mineWaiting = room.queue.filter((item) => item.by === you.id).length;
    const cannotAdd = !you.canAdd
      ? 'Only the host can add songs'
      : mineWaiting >= MAX_WAITING_EACH
        ? REFUSALS['own-limit']
        : room.queue.length >= MAX_WAITING
          ? REFUSALS['queue-full']
          : '';
    view.addLink.disabled = cannotAdd !== '';
    view.addLink.placeholder = cannotAdd || 'Paste a YouTube, SoundCloud or audio link';

    // Lists: rebuilt only when their contents change, never on every update.
    // Rebuilt only when its contents change, never on every update.
    const key = room.queue.map((item) => item.id).join(',') + `|${you.host}|${room.people.length}`;
    if (itemsKey !== key) {
      itemsKey = key;
      view.items.replaceChildren(...room.queue.map(itemRow));
    }
    view.queueEmpty.hidden = room.queue.length > 0;

    const waiting = room.notes.filter((note) => note.state === 'approval');
    const nextApprovals = waiting.map((note) => note.id).join(',') + `|${you.host}`;
    if (approvalsKey !== nextApprovals) {
      approvalsKey = nextApprovals;
      view.approvals.replaceChildren(
        ...waiting.map((note) => {
          const row = (view.approvalTemplate.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
          row.dataset['id'] = note.id;
          const own = note.by === you.id && !you.host;
          row.querySelector('.approval-text')!.textContent = own ? `Waiting for ${hostName} to approve` : `${note.byName} sent a voice note`;
          row.querySelector('.approval-note')!.textContent = `${Math.round(note.seconds)} s`;
          row.querySelector<HTMLElement>('[data-note="approve"]')!.hidden = own;
          return row;
        }),
      );
    }

    renderPeople();
    renderSettings();
  }

  function renderPeople(): void {
    if (!room) return;
    const { you } = room;
    const next = JSON.stringify(room.people) + you.host + room.settings.notes;
    if (peopleKey === next) return;
    peopleKey = next;
    view.people.replaceChildren(
      ...room.people
        .filter((person) => person.here)
        .map((person) => {
          const row = (view.personTemplate.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
          row.dataset['id'] = person.id;
          tint(row.querySelector<HTMLElement>('.logo')!, row.querySelector('.person-mono')!, person.name, person.colour);
          row.querySelector('.person-name')!.textContent = person.id === you.id ? `${person.name} (you)` : person.name;
          row.querySelector('.person-note')!.textContent = [person.host ? 'Host' : '', person.listening ? 'Listening' : '', person.askedMic ? 'Asked for the mic' : '']
            .filter(Boolean)
            .join('  ·  ');
          const manage = you.host && person.id !== you.id;
          const mic = row.querySelector<HTMLElement>('[data-person="mic"]')!;
          mic.hidden = !manage || room!.settings.notes !== 'selected';
          mic.textContent = person.mayNote ? 'Stop voice notes' : 'Allow voice notes';
          mic.dataset['allow'] = String(!person.mayNote);
          row.querySelector<HTMLElement>('[data-person="host"]')!.hidden = !manage;
          row.querySelector<HTMLElement>('[data-person="remove"]')!.hidden = !manage;
          return row;
        }),
    );
  }

  function renderSettings(): void {
    if (!room) return;
    if (document.activeElement !== view.settingName) view.settingName.value = room.name;
    for (const group of view.settingsDialog.querySelectorAll<HTMLElement>('[data-setting]')) {
      const value = String(room.settings[group.dataset['setting'] as keyof RoomView['settings']]);
      for (const option of group.querySelectorAll<HTMLElement>('[data-value]')) {
        option.setAttribute('aria-pressed', String(option.dataset['value'] === value));
      }
    }
  }

  /** The clock, the progress line and the countdowns move every quarter second. */
  function tick(): void {
    follow();
    if (!room) return;
    const { current } = room;
    const at = current ? Math.max(0, room.pausedAt ?? (now() - room.startAt) / 1000) : 0;
    const starting = current !== null && room.pausedAt === null && now() < room.startAt;
    const text = !current ? '' : starting ? `/ in ${Math.ceil((room.startAt - now()) / 1000)}` : current.seconds ? `/ ${duration(Math.min(at, current.seconds))} of ${duration(current.seconds)}` : '/ Live';
    if (view.time.textContent !== text) view.time.textContent = text;
    view.progress.style.width = current?.seconds ? `${Math.min(100, (at / current.seconds) * 100)}%` : '0';
    const state = !current ? 'empty' : room.pausedAt !== null ? 'paused' : starting ? 'starting' : 'playing';
    if (view.badge.dataset['state'] !== state || (room.you.canNote && room.you.nextNoteAt > now() - 1000)) render();
  }
  window.setInterval(tick, 250);

  // ------------------------------------------------------------------ adding a song

  let pending: { source: Source; details: Details } | null = null;
  let addTimer = 0;
  let addToken = 0;

  const PROBLEMS = { unknown: 'Paste a YouTube, SoundCloud or audio link', 'soundcloud-set': 'Add one track at a time' } as const;

  function clearAdd(problem = ''): void {
    pending = null;
    view.addPreview.hidden = true;
    view.addProblem.textContent = problem;
  }

  async function readLink(): Promise<void> {
    const token = ++addToken;
    const value = view.addLink.value.trim();
    if (!value) return clearAdd();
    const parsed = parseLink(value);
    if (typeof parsed === 'string') return clearAdd(PROBLEMS[parsed]);
    clearAdd('Reading the link…');
    try {
      const details = await readDetails(parsed);
      if (token !== addToken) return;
      if (details.seconds <= 0) return clearAdd(REFUSALS.live);
      if (details.seconds > MAX_SONG_SECONDS) return clearAdd(REFUSALS['too-long']);
      pending = { source: parsed, details };
      tint(view.addArt, view.addMono, details.title, undefined, details.image);
      view.addTitle.textContent = details.title;
      view.addMeta.textContent = duration(details.seconds);
      view.addPreview.hidden = false;
      view.addProblem.textContent = '';
    } catch (error) {
      if (token !== addToken) return;
      clearAdd(error instanceof Error && error.message === 'unseekable' ? 'That file cannot be played in a room' : 'That link cannot be played here');
    }
  }

  view.addLink.addEventListener('input', () => {
    window.clearTimeout(addTimer);
    addTimer = window.setTimeout(() => void readLink(), 350);
  });
  view.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) view.addButton.click();
    else void readLink();
  });
  view.addButton.addEventListener('click', () => {
    if (!pending) return;
    const { source, details } = pending;
    connection?.send({ type: 'add', source, title: details.title, seconds: details.seconds, ...(details.image ? { image: details.image } : {}) });
    view.addLink.value = '';
    clearAdd();
    // The host's device is the room's speaker: adding a song starts it, with no second tap.
    if (room?.you.host && !listening) startListening();
  });

  // ------------------------------------------------------------------ voice note sheet

  let stopRecording: (() => Promise<Recording>) | null = null;
  let recording: Recording | null = null;
  let when: 'now' | 'after' = 'now';
  const preview = new Audio();

  function resetNote(problem = ''): void {
    recording = null;
    view.noteTime.textContent = '0:00';
    view.noteWhen.hidden = view.noteActions.hidden = true;
    view.noteRecord.hidden = false;
    view.noteRecord.removeAttribute('data-recording');
    view.noteHint.textContent = 'Hold the button and speak. Up to 20 seconds.';
    view.noteProblem.textContent = problem;
  }

  async function beginRecording(): Promise<void> {
    if (stopRecording) return;
    view.noteProblem.textContent = '';
    try {
      const stop = await record(
        (seconds) => (view.noteTime.textContent = duration(seconds).replace(/^0/, '')),
        () => void endRecording(),
      );
      stopRecording = stop;
      view.noteRecord.setAttribute('data-recording', '');
      // Released before the microphone came on: stop straight away.
      if (!holding) void endRecording();
    } catch {
      resetNote("iRadio cannot use the microphone. Allow it in your browser's settings to send voice notes.");
    }
  }

  async function endRecording(): Promise<void> {
    const stop = stopRecording;
    if (!stop) return;
    stopRecording = null;
    const result = await stop();
    view.noteRecord.removeAttribute('data-recording');
    if (result.seconds < NOTE_MIN_SECONDS) return resetNote('Hold to record');
    recording = result;
    view.noteRecord.hidden = true;
    view.noteWhen.hidden = view.noteActions.hidden = false;
    view.noteHint.textContent = 'Listen back, then send it to the room.';
  }

  let holding = false;
  const press = (event: Event) => {
    event.preventDefault();
    holding = true;
    void beginRecording();
  };
  const release = () => {
    holding = false;
    void endRecording();
  };
  view.noteRecord.addEventListener('pointerdown', press);
  view.noteRecord.addEventListener('pointerup', release);
  view.noteRecord.addEventListener('pointercancel', release);
  view.noteRecord.addEventListener('pointerleave', release);
  view.noteRecord.addEventListener('keydown', (event) => event.key === ' ' && !event.repeat && press(event));
  view.noteRecord.addEventListener('keyup', (event) => event.key === ' ' && release());
  view.noteRecord.addEventListener('contextmenu', (event) => event.preventDefault());

  view.noteWhen.addEventListener('click', (event) => {
    const choice = (event.target as Element).closest<HTMLElement>('[data-when]');
    if (!choice) return;
    when = choice.dataset['when'] as 'now' | 'after';
    for (const option of view.noteWhen.querySelectorAll('[data-when]')) option.setAttribute('aria-pressed', String(option === choice));
  });
  el('note-preview').addEventListener('click', () => {
    if (!recording) return;
    preview.src = URL.createObjectURL(recording.audio);
    void preview.play();
  });
  el('note-again').addEventListener('click', () => resetNote());
  el('note-send').addEventListener('click', async () => {
    if (!recording || !code) return;
    const sending = recording;
    view.noteProblem.textContent = 'Sending…';
    try {
      const params = new URLSearchParams({ device, seconds: sending.seconds.toFixed(1), when });
      const response = await fetch(`/api/rooms/${code}/notes?${params}`, {
        method: 'PUT',
        headers: { 'Content-Type': sending.audio.type || 'audio/mp4' },
        body: sending.audio,
      });
      if (!response.ok) {
        const reason = ((await response.json()) as { error?: Refusal }).error;
        view.noteProblem.textContent = (reason && REFUSALS[reason]) || 'Could not send. Try again.';
        return;
      }
      view.noteDialog.close();
      host.toast(room?.settings.approveNotes && !room.you.host ? 'Sent for approval' : 'Voice note sent');
    } catch {
      view.noteProblem.textContent = 'Could not send. Check your connection.';
    }
  });
  view.noteDialog.addEventListener('close', () => {
    preview.pause();
    void endRecording();
  });

  // ------------------------------------------------------------------ actions

  function openShare(): void {
    if (!room) return;
    const link = `${window.location.origin}/r/${room.code}`;
    view.shareCode.textContent = room.code;
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    view.shareQr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    view.shareCopyLabel.textContent = 'Copy link';
    view.shareNative.hidden = typeof navigator.share !== 'function';
    view.shareCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        view.shareCopyLabel.textContent = 'Copied';
      } catch {
        view.shareCopyLabel.textContent = link;
      }
    };
    view.shareNative.onclick = () => void navigator.share({ title: room!.name, text: `Join my room on iRadio: ${room!.code}`, url: link }).catch(() => undefined);
    view.shareDialog.showModal();
  }

  /** Start playing the room on this device. Must run inside a tap: that is what lets a browser start sound. */
  function startListening(): void {
    listening = true;
    blocked = false;
    phase = 'idle';
    loaded = '';
    // The same tap wakes the voice-note player, so notes can be heard later without another one.
    noteAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    void noteAudio.play().catch(() => undefined);
    connection?.send({ type: 'listening', on: true });
    follow();
    render();
  }

  const actions: Record<string, () => void> = {
    create: () => void create(),
    share: openShare,
    people: () => view.peopleDialog.showModal(),
    settings: () => view.settingsDialog.showModal(),
    leave: () => {
      leave();
      host.toast('You can rejoin with the code.');
    },
    end: () => view.endDialog.showModal(),
    listen: () => {
      if (!listening || blocked) {
        startListening();
        return;
      }
      listening = false;
      silence();
      showPicture(null);
      connection?.send({ type: 'listening', on: false });
      render();
    },
    pause: () => connection?.send({ type: room?.pausedAt === null ? 'pause' : 'resume' }),
    skip: () => connection?.send({ type: 'skip' }),
    mic: () => {
      if (!room) return;
      if (!room.you.canNote) {
        connection?.send({ type: 'mic-ask' });
        return;
      }
      when = 'now';
      for (const option of view.noteWhen.querySelectorAll<HTMLElement>('[data-when]')) option.setAttribute('aria-pressed', String(option.dataset['when'] === 'now'));
      resetNote();
      view.noteDialog.showModal();
    },
  };

  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    const action = target.closest<HTMLElement>('[data-room]')?.dataset['room'];
    if (action) return actions[action]?.();

    const item = target.closest<HTMLElement>('[data-item]');
    if (item && room) {
      const id = item.closest<HTMLElement>('.item')!.dataset['id']!;
      connection?.send({ type: 'remove', item: id });
      return;
    }

    const person = target.closest<HTMLElement>('[data-person]');
    if (person) {
      const id = person.closest<HTMLElement>('.person')!.dataset['id']!;
      if (person.dataset['person'] === 'mic') connection?.send({ type: 'mic-allow', person: id, allow: person.dataset['allow'] === 'true' });
      if (person.dataset['person'] === 'host') connection?.send({ type: 'handover', person: id });
      if (person.dataset['person'] === 'remove') connection?.send({ type: 'kick', person: id });
      return;
    }

    const note = target.closest<HTMLElement>('[data-note]');
    if (note && code) {
      const id = note.closest<HTMLElement>('.approval')!.dataset['id']!;
      if (note.dataset['note'] === 'hear') {
        preview.src = `/api/rooms/${code}/notes/${id}`;
        void preview.play();
      } else {
        connection?.send({ type: note.dataset['note'] === 'approve' ? 'note-approve' : 'note-discard', id });
      }
      return;
    }

    const setting = target.closest<HTMLElement>('[data-setting] [data-value]');
    if (setting) {
      const name = setting.closest<HTMLElement>('[data-setting]')!.dataset['setting']!;
      const raw = setting.dataset['value']!;
      connection?.send({ type: 'settings', settings: { [name]: raw === 'true' ? true : raw === 'false' ? false : raw } });
    }
  });

  view.settingName.addEventListener('change', () => connection?.send({ type: 'settings', settings: {}, name: view.settingName.value }));
  el('end-confirm').addEventListener('click', () => connection?.send({ type: 'end' }));
  el('end-cancel').addEventListener('click', () => view.endDialog.close());
  view.nameInput.addEventListener('input', () => (view.nameContinue.disabled = view.nameInput.value.trim().length < NAME_MIN));
  view.volume.addEventListener('input', () => {
    level = view.volume.valueAsNumber / 100;
    store('iradio.room-volume', String(view.volume.valueAsNumber));
    render();
  });
  view.joinCode.addEventListener('input', () => {
    view.joinButton.disabled = tidyCode(view.joinCode.value) === null;
    view.lobbyProblem.textContent = '';
  });
  view.joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const target = tidyCode(view.joinCode.value);
    if (target) enter(target);
  });

  // ------------------------------------------------------------------ arriving by link, or coming back

  const linked = tidyCode(window.location.pathname.startsWith('/r/') ? window.location.pathname : '');
  const remembered = tidyCode(stored('iradio.room'));
  showLobby();
  if (linked) enter(linked);

  return {
    show: () => {
      view.rooms.hidden = false;
      // Coming back to Rooms after a reload: rejoin the room this device was in.
      if (!code && !linked && remembered && !view.nameDialog.open) enter(remembered);
    },
    inRoom: () => room !== null,
    sounding: () => listening && phase === 'playing' && !blocked,
    anchor: () => (room ? view.frameArt : null),
    orbs: () =>
      room
        ? room.people
            .filter((person) => person.here)
            // Brightest while their voice note plays, bright while listening, dim while just present.
            .map((person) => ({ hue: HUES[person.colour % HUES.length]!, energy: person.name === speaker ? 1 : person.listening ? 0.55 : 0.15 }))
        : LOBBY_ORBS,
    code: () => room?.code ?? null,
    addStation: (station) => {
      if (!room) return;
      connection?.send({ type: 'add', source: { kind: 'station', station }, title: station.name, seconds: 0, ...(station.logo ? { image: station.logo } : {}) });
      host.toast(`Added ${station.name} to the room`);
      if (room.you.host && !listening) startListening();
    },
  };
}

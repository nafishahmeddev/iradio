import { describe, expect, it } from 'vitest';

import { makeCode, tidyCode } from '../../src/lib/rooms/code';
import { between, correct, envelope, glide, learnLead } from '../../src/lib/rooms/follow';
import { fileTitle, parseLink } from '../../src/lib/rooms/links';
import { CODE_ALPHABET, EMPTY_ROOM_MS, HEAD_START_MS, HOST_AWAY_MS, ROOM_LIFE_MS } from '../../src/lib/rooms/limits';
import { parseEvent, viewFor } from '../../src/lib/rooms/protocol';
import { apply, createRoom, hostDevice, position, wakeAt, type RoomEvent, type RoomState, type Source } from '../../src/lib/rooms/room';

const T0 = 1_000_000;
const song = (id: string, seconds = 200): RoomEvent => ({
  type: 'add',
  source: { kind: 'youtube', id: id.padEnd(11, 'x') },
  title: `Song ${id}`,
  seconds,
});

/** A room that plays a script of events and fails the test if one is unexpectedly refused. */
function session() {
  let state: RoomState = createRoom('K7M2QX', 'host', "Sam's room", T0);
  const notices: string[] = [];
  const act = (device: string, event: RoomEvent, now = T0) => {
    const outcome = apply(state, device, event, now);
    state = outcome.state;
    if (outcome.notice) notices.push(outcome.notice);
    return outcome;
  };
  act('host', { type: 'join', name: 'Sam' });
  return {
    act,
    notices,
    get state() {
      return state;
    },
    join: (device: string, name: string, now = T0) => act(device, { type: 'join', name }, now),
    titles: () => state.queue.map((item) => item.title),
  };
}

describe('room codes', () => {
  it('uses only characters that can be read aloud', () => {
    for (let i = 0; i < 50; i++) expect([...makeCode()].every((char) => CODE_ALPHABET.includes(char))).toBe(true);
    expect(makeCode(() => 0)).toBe('222222');
  });

  it('accepts what people type, and a pasted link', () => {
    expect(tidyCode('k7m 2qx')).toBe('K7M2QX');
    expect(tidyCode('K7M-2QX')).toBe('K7M2QX');
    expect(tidyCode('https://example.app/r/k7m2qx?x=1')).toBe('K7M2QX');
    expect(tidyCode('K7M2Q')).toBeNull();
    expect(tidyCode('K7M2Q0')).toBeNull();
  });
});

describe('links', () => {
  it('recognises every YouTube form', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1',
      'https://youtu.be/dQw4w9WgXcQ?t=4',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      expect(parseLink(link), link).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ' });
    }
  });

  it('recognises SoundCloud tracks but not sets', () => {
    expect(parseLink('https://soundcloud.com/forss/flickermood?si=1')).toEqual({ kind: 'soundcloud', url: 'https://soundcloud.com/forss/flickermood' });
    expect(parseLink('https://soundcloud.com/forss/sets/soulhack')).toBe('soundcloud-set');
  });

  it('recognises secure audio files only', () => {
    expect(parseLink('https://files.example/a/My_Song-live.mp3?x=1')).toEqual({ kind: 'file', url: 'https://files.example/a/My_Song-live.mp3?x=1' });
    expect(parseLink('http://files.example/a.mp3')).toBe('unknown');
    expect(parseLink('https://example.com/page')).toBe('unknown');
    expect(parseLink('not a link')).toBe('unknown');
    expect(fileTitle('https://files.example/a/My_Song-live.mp3')).toBe('My Song live');
  });
});

describe('joining and leaving', () => {
  it('gives the host a listening device and guests a silent one', () => {
    const room = session();
    room.join('g1', 'Maya');
    const [sam, maya] = room.state.people;
    expect(sam).toMatchObject({ name: 'Sam', listening: true, colour: 0 });
    expect(maya).toMatchObject({ name: 'Maya', listening: false, colour: 1 });
  });

  it('numbers a repeated name', () => {
    const room = session();
    room.join('g1', 'Sam');
    room.join('g2', 'Sam');
    expect(room.state.people.map((person) => person.name)).toEqual(['Sam', 'Sam 2', 'Sam 3']);
  });

  it('refuses new people when locked, but lets known people back', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', { type: 'settings', settings: { locked: true } });
    expect(room.act('g2', { type: 'join', name: 'Lee' }).refused).toBe('locked');
    room.act('g1', { type: 'leave' });
    expect(room.join('g1', 'Maya').refused).toBeUndefined();
  });

  it('refuses the 51st person', () => {
    const room = session();
    for (let i = 1; i < 50; i++) room.join(`g${i}`, `Guest ${i}`);
    expect(room.act('late', { type: 'join', name: 'Late' }).refused).toBe('full');
  });

  it('keeps a removed person out and drops their songs', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('a'));
    room.act('g1', song('b'));
    room.act('g1', song('c'));
    const maya = room.state.people[1]!.id;
    const outcome = room.act('host', { type: 'kick', person: maya });
    expect(outcome.disconnect).toEqual(['g1']);
    expect(room.titles()).toEqual([]);
    expect(room.act('g1', { type: 'join', name: 'Maya' }).refused).toBe('removed');
  });
});

describe('who is host', () => {
  it('passes hosting to the longest-present guest after a minute, and back when the host returns', () => {
    const room = session();
    room.join('g1', 'Maya', T0 + 1);
    room.join('g2', 'Lee', T0 + 2);
    room.act('host', { type: 'leave' }, T0 + 10);
    expect(hostDevice(room.state)).toBe('host');
    expect(wakeAt(room.state)).toBe(T0 + 10 + HOST_AWAY_MS);
    room.act('host', { type: 'wake' }, T0 + 10 + HOST_AWAY_MS);
    expect(hostDevice(room.state)).toBe('g1');
    room.join('host', 'Sam', T0 + 200_000);
    expect(hostDevice(room.state)).toBe('host');
    expect(room.notices).toEqual(['Maya is now the host', 'Sam is back as host']);
  });

  it('lets the host hand over for good', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', { type: 'handover', person: room.state.people[1]!.id });
    expect(hostDevice(room.state)).toBe('g1');
    expect(room.act('host', { type: 'pause' }).refused).toBe('not-allowed');
  });
});

describe('the queue', () => {
  it('starts the first song after a head start', () => {
    const room = session();
    room.act('host', song('a'), T0 + 5);
    expect(room.state.current?.title).toBe('Song a');
    expect(room.state.startAt).toBe(T0 + 5 + HEAD_START_MS);
    expect(position(room.state, T0 + 5)).toBe(-3);
  });

  it('rotates turns so one person cannot fill it', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('now'));
    for (const id of ['s1', 's2', 's3']) room.act('host', song(id));
    room.act('g1', song('m1'));
    room.act('g1', song('m2'));
    expect(room.titles()).toEqual(['Song s1', 'Song m1', 'Song s2', 'Song m2', 'Song s3']);
  });

  it('enforces the limits', () => {
    const room = session();
    room.act('host', song('now'));
    for (let i = 0; i < 5; i++) room.act('host', song(`q${i}`));
    expect(room.act('host', song('q6')).refused).toBe('own-limit');
    expect(room.act('host', song('now')).refused).toBe('own-limit');
    const other = session();
    other.act('host', song('a'));
    expect(other.act('host', song('a')).refused).toBe('duplicate');
    expect(other.act('host', song('long', 901)).refused).toBe('too-long');
    expect(other.act('host', song('live', 0)).refused).toBe('live');
  });

  it('lets only the host add when the setting says so', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', { type: 'settings', settings: { adders: 'host' } });
    expect(room.act('g1', song('a')).refused).toBe('not-allowed');
    expect(room.act('host', song('a')).refused).toBeUndefined();
  });

  it('lets only the person who added a song, or the host, delete it', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.join('g2', 'Lee');
    room.act('host', song('now'));
    room.act('g1', song('m'));
    const id = room.state.queue[0]!.id;
    expect(room.act('g2', { type: 'remove', item: id }).refused).toBe('not-allowed');
    room.act('g1', { type: 'remove', item: id });
    expect(room.titles()).toEqual([]);
  });

  it('cannot be reordered by anyone', () => {
    expect(parseEvent({ type: 'move', item: 'i1', to: 0 })).toBeNull();
  });

  it('moves on by itself when a song ends', () => {
    const room = session();
    room.act('host', song('a', 100));
    room.act('host', song('b', 100));
    const end = wakeAt(room.state)!;
    expect(end).toBe(T0 + HEAD_START_MS + 100_000 + 400);
    room.act('host', { type: 'wake' }, end);
    expect(room.state.current?.title).toBe('Song b');
    expect(room.state.queue).toEqual([]);
  });

  it('plays a station until it is skipped', () => {
    const room = session();
    const station: Source = { kind: 'station', station: { name: 'FIP', url: 'https://fip.example/live', country: '', countrycode: 'FR', bitrate: 0, tags: '' } };
    room.act('host', { type: 'add', source: station, title: 'FIP', seconds: 0 });
    expect(room.state.current?.seconds).toBe(0);
    expect(wakeAt(room.state)).toBe(T0 + ROOM_LIFE_MS);
  });
});

describe('skipping', () => {
  it('is immediate for the host', () => {
    const room = session();
    room.act('host', song('a'));
    room.act('host', song('b'));
    room.act('host', { type: 'skip' });
    expect(room.state.current?.title).toBe('Song b');
  });

  it('needs more than half the room, and at least two votes, from guests', () => {
    const room = session();
    for (const [device, name] of [['g1', 'Maya'], ['g2', 'Lee'], ['g3', 'Noor']] as const) room.join(device, name);
    room.act('host', song('a'));
    room.act('host', song('b'));
    room.act('g1', { type: 'skip' });
    room.act('g1', { type: 'skip' });
    expect(room.state.current?.votes).toHaveLength(1);
    room.act('g2', { type: 'skip' });
    expect(room.state.current?.title).toBe('Song a');
    room.act('g3', { type: 'skip' });
    expect(room.state.current?.title).toBe('Song b');
    expect(room.state.current?.votes).toEqual([]);
  });

  it('skips a song the host device cannot play', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('a'));
    const id = room.state.current!.id;
    room.act('g1', { type: 'failed', item: id });
    expect(room.state.current?.id).toBe(id);
    room.act('host', { type: 'failed', item: id });
    expect(room.state.current).toBeNull();
  });
});

describe('pausing', () => {
  it('holds the position and resumes from it', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('a'));
    expect(room.act('g1', { type: 'pause' }).refused).toBe('not-allowed');
    room.act('host', { type: 'pause' }, T0 + HEAD_START_MS + 30_000);
    expect(room.state.pausedAt).toBe(30);
    expect(wakeAt(room.state)).toBe(T0 + ROOM_LIFE_MS);
    room.act('host', { type: 'resume' }, T0 + 500_000);
    expect(position(room.state, T0 + 500_000)).toBe(30);
  });
});

describe('voice notes', () => {
  const note = (id: string, when: 'now' | 'after' = 'now', seconds = 10): RoomEvent => ({ type: 'note', id, seconds, when });

  it('follows the who-may-send setting, with asking and allowing', () => {
    const room = session();
    room.join('g1', 'Maya');
    // A new room lets everyone send; the host can narrow it to chosen people.
    expect(room.state.settings.notes).toBe('everyone');
    room.act('host', { type: 'settings', settings: { notes: 'selected' } });
    expect(room.act('g1', note('n1')).refused).toBe('not-allowed');
    room.act('g1', { type: 'mic-ask' });
    expect(room.state.people[1]).toMatchObject({ askedMic: true, mayNote: false });
    room.act('host', { type: 'mic-allow', person: room.state.people[1]!.id, allow: true });
    expect(room.act('g1', note('n1')).refused).toBeUndefined();
    room.act('host', { type: 'settings', settings: { notes: 'host' } });
    expect(room.act('g1', note('n2'), T0 + 100_000).refused).toBe('not-allowed');
  });

  it('allows one note a minute each', () => {
    const room = session();
    room.act('host', note('n1'));
    expect(room.act('host', note('n2'), T0 + 59_000).refused).toBe('note-rate');
    expect(room.act('host', note('n2'), T0 + 60_000).refused).toBeUndefined();
  });

  it('plays a note straight away when sent now, mid-song', () => {
    const room = session();
    room.act('host', song('a', 200));
    room.act('host', note('n1'), T0 + 50_000);
    expect(room.state.notes[0]).toMatchObject({ state: 'scheduled', playAt: T0 + 51_500 });
  });

  it('holds a note for the gap when the song is nearly over, or when asked to', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('a', 100));
    room.act('host', song('b', 100));
    const nearEnd = T0 + HEAD_START_MS + 95_000;
    room.act('host', note('late'), nearEnd);
    room.act('g1', note('after', 'after', 5), nearEnd);
    expect(room.state.notes.map((waiting) => waiting.state)).toEqual(['waiting', 'waiting']);

    const end = T0 + HEAD_START_MS + 100_000;
    room.act('host', { type: 'wake' }, end);
    const [first, second] = room.state.notes;
    expect(first).toMatchObject({ state: 'scheduled', playAt: end + 500 });
    // One after another, never together.
    expect(second!.playAt).toBe(first!.playAt + 10_000 + 500);
    // The next song waits for the notes, then takes its head start.
    expect(room.state.startAt).toBe(second!.playAt + 5_000 + HEAD_START_MS);
  });

  it('waits while the room is paused', () => {
    const room = session();
    room.act('host', song('a', 200));
    room.act('host', { type: 'pause' }, T0 + 20_000);
    room.act('host', note('n1'), T0 + 21_000);
    expect(room.state.notes[0]?.state).toBe('waiting');
    room.act('host', { type: 'resume' }, T0 + 90_000);
    expect(room.state.notes[0]).toMatchObject({ state: 'scheduled', playAt: T0 + 91_500 });
  });

  it('goes to the host first when approval is on', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', { type: 'settings', settings: { notes: 'everyone', approveNotes: true } });
    room.act('g1', note('n1'));
    expect(room.state.notes[0]?.state).toBe('approval');
    expect(viewFor(room.state, 'host').notes).toHaveLength(1);
    room.act('host', { type: 'note-approve', id: 'n1' });
    expect(room.state.notes[0]?.state).toBe('scheduled');
  });

  it('forgets a note once it has played', () => {
    const room = session();
    room.act('host', note('n1', 'now', 4));
    const done = wakeAt(room.state)!;
    const outcome = room.act('host', { type: 'wake' }, done);
    expect(outcome.dropped).toEqual(['n1']);
    expect(room.state.notes).toEqual([]);
  });
});

describe('the room ending', () => {
  it('closes after 30 empty minutes, or 24 hours, or when the host ends it', () => {
    const empty = session();
    empty.act('host', { type: 'leave' }, T0 + 1000);
    expect(wakeAt(empty.state)).toBe(T0 + 1000 + EMPTY_ROOM_MS);
    const outcome = empty.act('host', { type: 'wake' }, T0 + 1000 + EMPTY_ROOM_MS);
    expect(outcome.state.closed).toBe(true);

    const old = session();
    expect(old.act('host', { type: 'wake' }, T0 + ROOM_LIFE_MS).state.closed).toBe(true);

    const ended = session();
    ended.join('g1', 'Maya');
    expect(ended.act('g1', { type: 'end' }).refused).toBe('not-allowed');
    const end = ended.act('host', { type: 'end' });
    expect(end.state.closed).toBe(true);
    expect(end.disconnect.sort()).toEqual(['g1', 'host']);
    expect(ended.act('g1', { type: 'join', name: 'Maya' }).refused).toBe('ended');
  });
});

describe('what each person is sent', () => {
  it('never includes a device ID, and marks the viewer\'s own vote', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('a'));
    room.act('g1', { type: 'skip' });
    const view = viewFor(room.state, 'g1');
    expect(JSON.stringify(view)).not.toMatch(/"device"|"g1"|"host":"host"/);
    expect(view.you).toMatchObject({ host: false, canAdd: true, canNote: true });
    expect(view.current).toMatchObject({ votes: 1, voted: true });
    expect(viewFor(room.state, 'host').current).toMatchObject({ votes: 1, voted: false });
  });
});

describe('messages from a device', () => {
  it('accepts well-formed messages', () => {
    expect(parseEvent({ type: 'skip' })).toEqual({ type: 'skip' });
    expect(parseEvent({ type: 'add', source: { kind: 'youtube', id: 'dQw4w9WgXcQ' }, title: 'Song', seconds: 213, image: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })).toMatchObject({ type: 'add', seconds: 213 });
    expect(parseEvent({ type: 'settings', settings: { locked: true, adders: 'nobody' } })).toEqual({ type: 'settings', settings: { locked: true } });
  });

  it('drops anything else', () => {
    for (const bad of [
      null,
      'skip',
      { type: 'wake' },
      { type: 'join', name: 'Sam' },
      { type: 'note', id: 'n', seconds: 5, when: 'now' },
      { type: 'add', source: { kind: 'youtube', id: 'short' }, title: 'x', seconds: 1 },
      { type: 'add', source: { kind: 'file', url: 'http://a.example/x.mp3' }, title: 'x', seconds: 1 },
      { type: 'add', source: { kind: 'youtube', id: 'dQw4w9WgXcQ' }, title: 'x', seconds: -1 },
      { type: 'move', item: 'i1', to: 1.5 },
      { type: 'rename', name: 'A' },
    ]) {
      expect(parseEvent(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('staying in step', () => {
  it('leaves a player alone when it is within 40 ms', () => {
    expect(correct(0.03, 50, 'steps', 0)).toEqual({ kind: 'none' });
    expect(correct(-0.03, 50, 'fine', 0)).toEqual({ kind: 'none' });
  });

  it('closes a small gap by changing speed for exactly as long as it takes', () => {
    // 0.2 s ahead at three-quarter speed loses 0.25 s per second: 0.8 s.
    expect(correct(0.2, 50, 'steps', 0)).toEqual({ kind: 'rate', rate: 0.75, forMs: 800 });
    expect(correct(-0.5, 50, 'steps', 0)).toEqual({ kind: 'rate', rate: 1.25, forMs: 2000 });
  });

  it('uses an inaudibly small speed change where any speed is possible', () => {
    expect(correct(0.05, 50, 'fine', 0)).toEqual({ kind: 'rate', rate: 0.97, forMs: 1000 });
    expect(correct(-0.9, 50, 'fine', 0)).toEqual({ kind: 'rate', rate: 1.08, forMs: 1000 });
  });

  it('jumps when the gap is too large, aiming ahead by the time a jump takes', () => {
    expect(correct(-3, 50, 'steps', 0.4)).toEqual({ kind: 'seek', to: 50.4 });
    expect(correct(1.5, 50, 'fine', 0.2)).toEqual({ kind: 'seek', to: 50.2 });
  });

  it('only jumps a fixed-speed player once the gap is plainly audible', () => {
    expect(correct(0.2, 50, 'none', 0.3)).toEqual({ kind: 'none' });
    expect(correct(0.3, 50, 'none', 0.3)).toEqual({ kind: 'seek', to: 50.3 });
  });

  it('learns how long this device takes to land a jump', () => {
    // Landed 0.3 s behind: aim further ahead next time.
    expect(learnLead(0, -0.3)).toBeCloseTo(0.21);
    expect(learnLead(0.21, 0.1)).toBeCloseTo(0.14);
    expect(learnLead(0, 5)).toBe(0);
    expect(learnLead(1.9, -5)).toBe(2);
  });

  it('works out the position between a player\'s reports', () => {
    expect(between(10, 1000, 1200, 1, true)).toBeCloseTo(10.2);
    expect(between(10, 1000, 1200, 1.25, true)).toBeCloseTo(10.25);
    expect(between(10, 1000, 1200, 1, false)).toBe(10);
    // A stalled player is not assumed to have run on.
    expect(between(10, 1000, 9000, 1, true)).toBeCloseTo(10.6);
  });
});

describe('fades', () => {
  it('eases a song in at its start and out at its end', () => {
    expect(envelope(-1, 200, 1.2, 2.5)).toBe(0);
    expect(envelope(0.6, 200, 1.2, 2.5)).toBeCloseTo(0.5);
    expect(envelope(100, 200, 1.2, 2.5)).toBe(1);
    expect(envelope(198.75, 200, 1.2, 2.5)).toBeCloseTo(0.5);
    expect(envelope(200, 200, 1.2, 2.5)).toBe(0);
    expect(envelope(205, 200, 1.2, 2.5)).toBe(0);
  });

  it('only eases a station in, since it has no end', () => {
    expect(envelope(0.6, 0, 1.2, 2.5)).toBeCloseTo(0.5);
    expect(envelope(9000, 0, 1.2, 2.5)).toBe(1);
  });

  it('never snaps loudness, and never overshoots', () => {
    expect(glide(0, 1, 100, 500)).toBeCloseTo(0.2);
    expect(glide(1, 0.15, 100, 500)).toBeCloseTo(0.8);
    expect(glide(0.9, 1, 5000, 500)).toBe(1);
    expect(glide(0.2, 0.15, 5000, 500)).toBe(0.15);
  });
});

describe('a room waking itself', () => {
  /** Run a room forward by its own wake-ups alone and count them. */
  function run(room: ReturnType<typeof session>, from: number) {
    let now = from;
    let wakes = 0;
    for (; wakes < 50; wakes++) {
      const next = wakeAt(room.state);
      if (next === null) break;
      // A wake-up that is not in the future is a room spinning in place.
      expect(next, `wake ${wakes} at ${now}`).toBeGreaterThan(now);
      now = next;
      room.act('', { type: 'wake' }, now);
    }
    return { wakes, closed: room.state.closed };
  }

  it('does not spin when the host leaves an empty room', () => {
    const room = session();
    room.act('host', { type: 'leave' }, T0 + 1000);
    // One wake: the room closing after 30 empty minutes.
    expect(wakeAt(room.state)).toBe(T0 + 1000 + EMPTY_ROOM_MS);
    expect(run(room, T0 + 1000)).toEqual({ wakes: 1, closed: true });
  });

  it('does not spin when everyone leaves mid-song with songs waiting', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('a', 100));
    room.act('g1', song('b', 100));
    room.act('host', { type: 'leave' }, T0 + 5000);
    room.act('g1', { type: 'leave' }, T0 + 6000);
    const result = run(room, T0 + 6000);
    expect(result.closed).toBe(true);
    expect(result.wakes).toBeLessThan(6);
  });

  it('does not spin when the stand-in host leaves too', () => {
    const room = session();
    room.join('g1', 'Maya', T0 + 1);
    room.act('host', { type: 'leave' }, T0 + 10);
    room.act('', { type: 'wake' }, T0 + 10 + HOST_AWAY_MS);
    expect(hostDevice(room.state)).toBe('g1');
    room.act('g1', { type: 'leave' }, T0 + 200_000);
    expect(run(room, T0 + 200_000)).toEqual({ wakes: 1, closed: true });
  });

  it('always moves forward through a full session', () => {
    const room = session();
    room.join('g1', 'Maya');
    room.act('host', song('a', 30));
    room.act('g1', song('b', 30));
    room.act('host', { type: 'note', id: 'n1', seconds: 5, when: 'after' }, T0 + 1000);
    const result = run(room, T0 + 1000);
    expect(result.wakes).toBeLessThan(12);
  });
});

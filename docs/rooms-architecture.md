# Rooms: the architecture

Written 2026-10-12, alongside [rooms-plan.md](rooms-plan.md). Rooms is now built along
these lines; where the build differs, this document says what was built.

This defines where the code goes, how it is organised and the style it is
written in. Parts marked **[after tests]** depend on the phone tests in the
plan and are settled when those results are in.

## 1. The shape in one picture

```text
Phone or laptop                              Cloudflare (account: iRadio)
┌──────────────────────────────┐            ┌─────────────────────────────┐
│ Room screen                  │  changes   │ Worker (Hono)               │
│   queue, people, settings    │◄──────────►│   /api/rooms ...            │
│ Shared clock ◄── Cloudflare's│  WebSocket │        │                    │
│                time endpoint │            │        ▼                    │
│ Players                      │            │ Room (Durable Object)       │
│   YouTube · SoundCloud       │            │   one per room code         │
│   audio file · station       │            │   queue, timeline, people   │
└──────────────┬───────────────┘            │   voice notes               │
               │ audio, direct              └─────────────────────────────┘
               ▼
   YouTube / SoundCloud / file host / broadcaster
```

The server holds the room's facts and passes on changes. Audio never goes
through it, except voice notes.

## 2. Where the code goes

New folders sit beside the existing ones and follow the same split: pure
logic in `src/lib`, server in `worker`, interface in `src/components` and
`src/scripts`.

```text
src/lib/rooms/            Pure logic. No browser, no Cloudflare. All of it tested.
  code.ts                 Room codes: alphabet, make, tidy up what was typed
  links.ts                Recognise YouTube, SoundCloud and audio links
  limits.ts               Every number from the plan, in one place
  queue.ts                Turn order, where a new item goes, dragging
  votes.ts                The skip rule
  timeline.ts             Where a song should be at a given moment
  notes.ts                When a voice note plays: now, in the gap, or waiting
  people.ts               Names, colours, who becomes host
  protocol.ts             Every message between device and room, and its checks
  room.ts                 The room itself: (state, event) -> new state + things to do

worker/
  index.ts                Adds the room routes to the existing Hono app
  room.ts                 The Durable Object: a thin shell around lib/rooms/room.ts
  main.ts                 The Worker's entry: the API plus the Room class

src/scripts/rooms/
  connection.ts           The WebSocket: join, reconnect, send, receive
  clock.ts                The shared clock
  follower.ts             Keeps a player in step with the timeline
  players/                One file per source, all with the same interface
    youtube.ts  soundcloud.ts  file.ts  station.ts
  recorder.ts             Recording and previewing a voice note
  room.ts                 The room screen: state in, DOM out

src/components/rooms/     Astro components for the room screens and sheets
tests/rooms/              One test file per file in src/lib/rooms
```

## 3. The room is a pure function

The whole room is one function in `src/lib/rooms/room.ts`:

```text
(room state, event, time now) -> { new state, messages to send, next wake-up }
```

An event is something a person did (join, add, skip, vote, send a note) or
time passing (a song ended, the host has been gone 60 seconds).

Why this shape:

- **Every rule in the plan gets a plain test**, with no server to start. The
  plan requires this.
- **The Durable Object stays thin.** It receives a message, calls the
  function, saves the result, sends the messages, sets its alarm.
- **The device can run the same rules** to grey out a control before the
  server would refuse it ("You have 5 songs waiting").

The server is the only authority. A device's copy of the rules is for
showing state, never for deciding it.

## 4. The server

### Routes

| Route | Does |
| --- | --- |
| `POST /api/rooms` | Makes a room; answers with its code |
| `GET /api/rooms/:code/live` | Upgrades to the room's WebSocket |
| `PUT /api/rooms/:code/notes` | Uploads a voice note (the audio only) |
| `GET /api/rooms/:code/notes/:id` | Downloads one, by an unguessable ID |
| `GET /r/:code` | Serves the app's page; the app reads the code from the address |

Everything else in a room travels over the WebSocket.

### One Durable Object per room

- Found by the room code, so anyone with the code reaches the same object.
- SQLite-backed (the kind the free plan includes).
- Uses WebSocket hibernation: between messages the object sleeps, and
  sleeping time is not billed. A device that is only listening sends
  nothing, so a quiet room costs nothing while it plays.
- One alarm, set to the soonest of: the current song ending, a host handover
  falling due, a voice note falling due, the room's closing time.

### What is stored

| Table | Holds |
| --- | --- |
| `room` | Code, name, created, host, settings, timeline, closed |
| `people` | Private device ID, public ID, name, colour, joined, flags |
| `items` | The queue and the last 20 played |
| `notes` | Voice notes: sender, length, timing, approval, the audio |

All of it is deleted when the room closes.

### Making a code

A new code is drawn at random and claimed in its object. If the object
already holds a live room, another is drawn, up to 5 times. With 31
characters and 6 places there are about 887 million codes, so a clash is
rare.

## 5. Messages

Defined once in `src/lib/rooms/protocol.ts` and used by both sides.

- On every change, each device is sent the **whole room as that person sees
  it**. A room is small (at most 100 queued items), so this is a few
  kilobytes, and it means a device can never drift out of date or need to ask
  for a resync.
- Small numbered changes were considered and left out: they save bytes that
  Cloudflare does not charge for, at the cost of gap detection and resync
  logic on every device.

Every message from a device is checked before it is used: its type, every
field, every length. Anything else is dropped. This is the same approach the
app already takes with station data.

| From a device | From the room |
| --- | --- |
| join, rename, leave | the whole room |
| add, remove, move, skip, vote | a numbered change |
| pause, resume | "play this at this moment" |
| listening on or off | a voice note is due |
| note: send, approve, discard | an error with its reason |
| ask for the mic, allow, stop | |
| settings, hand over, remove person, end room | |

## 6. The device

### Players

Four sources, one interface, so the rest of the app never asks which source
is playing:

```text
load(item)   play()   pause()   seek(seconds)   position()   setVolume(0..1)
onReady   onEnded   onError
```

`station.ts` wraps the player the app already has. The follower and the
voice-note fade are written once against this interface.

### Staying in step

The follow loop in `src/scripts/rooms/room.ts` starts each song once and then
leaves the player alone. Once a second it compares where the player is with
where the timeline says it should be, and jumps only if two readings in a row
are more than 5 seconds off. Smooth playing matters more than exact timing: a
correction interrupts the sound. It sends nothing to the server.

### The shared clock

`clock.ts` measures the difference between the device's clock and the
Worker's time route, taking the quickest of 5 measurements, and repeats
every 5 minutes. Cloudflare's own time endpoint was the first choice, but on
the live site it reports whole seconds only.

### Fading for a voice note

Through `setVolume` on whichever player is active. If iPhone will not lower
YouTube's volume, the fallback is to pause for the note. **[after tests]**

## 7. Who someone is, and safety

| Concern | Handling |
| --- | --- |
| Identity | A random device ID, made once and kept on the device. The room maps it to a public ID; other people never see the device ID |
| Host | The device ID that made the room. This is what lets the host come back and be host again |
| Removed people | The room keeps their device ID and refuses it |
| Flooding | The room counts each person's messages and drops the excess: 20 per 10 seconds |
| Size | Messages up to 4 KB; voice notes up to 400 KB |
| Names and titles | Cleaned of control characters and capped in length, as station names are now |
| Other sites | The WebSocket is refused unless it comes from the app's own address |
| Voice notes | Fetched by an ID that cannot be guessed; never listed, never cached publicly |

## 8. Coding style

The same as the rest of the app. Stated here so it is not left to habit.

- **TypeScript at the strictest setting.** No `any`.
- **Pure logic first.** A rule lives in `src/lib/rooms`, takes plain values,
  returns plain values, and has a test. If a rule needs the clock, the time
  is passed in.
- **Numbers live in `limits.ts`.** No rule carries its own number.
- **No UI framework.** Astro components for markup; small TypeScript modules
  for behaviour. The grid lesson applies: update what changed, never rebuild
  a list because one thing in it moved.
- **Design tokens only.** No colour, size or font outside `tokens.css`. A
  missing piece is added to the system first.
- **Every state has a look.** A control that cannot act is disabled with its
  reason; nothing is left to fail on tap.
- **Comments say why,** in plain words. They do not restate the code.
- **Words come from the plan.** Section 10 of the plan is the source for
  every label and message; code does not invent wording.
- **Workers-safe on the server.** No Node-only APIs, nothing large held in
  memory.

## 9. Testing

| What | How |
| --- | --- |
| Every rule in the plan | A unit test in `tests/rooms`, against the pure functions |
| The room function | Scripted sessions: a list of events in, the expected state and messages out |
| Messages | Each kind accepted when valid, dropped when not |
| The Durable Object shell | Run on Wrangler's local runtime with real connections |
| Players and sync | On real phones; this is what the lab is for |

## 10. Cost on the free plan

| Measure | Free allowance | A 3-hour room of 20 people |
| --- | --- | --- |
| Requests | 100,000 a day | A few hundred: joins, adds, skips, notes |
| Time awake | 13,000 GB-seconds a day | Seconds, because the room sleeps between messages |
| Storage | 5 GB | Under 5 MB, deleted on close |

**[after tests]** The allowances are from Cloudflare's published free plan
and should be re-checked against the account once the lab is deployed.

## 11. Settled when the phone tests are in

| Test | Decides |
| --- | --- |
| Shared clock | Whether Cloudflare's time endpoint is used, or the Worker's |
| YouTube in step | Whether 0.35 seconds is the right tolerance |
| Fading | Fade, or pause for a voice note, on iPhone |
| SoundCloud | Whether it stays as a source |
| Audio files | How "can be jumped to a position" is detected |
| Voice notes | Which recording format each phone uses, and whether any conversion is needed |
| Sharing from YouTube | Whether the Android share route is built |

## 12. Order of work after this phase

1. Phase 3, design: system additions, gallery, then every room screen on mock data.
2. Phase 4, logic: `src/lib/rooms` with its tests first, then the Durable
   Object, then the players, then wiring to the finished screens.

# Rooms: the plan

Phase 1 of 7 (Plan). Nothing here is built. Written 2026-10-12; confirmed by you the same day.

A room is a shared listening session. One person creates it, others join with
a code, everyone drops songs into one queue, and anyone can send a short
recorded voice note that plays over the music. The music plays on the host's
device, and on any other device whose owner chooses to listen along, in sync.

Items marked **[prove]** are assumptions that phase 2 must test on a real
device before design starts. If one fails, this plan is reopened.

## 1. Scope

| In | Out |
| --- | --- |
| Create a room, join by code, link or QR | Accounts, passwords, profiles |
| A shared queue of YouTube songs and radio stations | Uploading music files |
| Playback on the host's device | Searching YouTube inside the app |
| Any guest listening along in sync | Live (real-time) voice |
| Recorded voice notes that fade the music | Text chat |
| Host controls and room settings | Private or invite-only rooms beyond the lock |
| | Playing with the phone locked |

## 2. Words used in the app

| Word | Meaning |
| --- | --- |
| Room | One shared session, known by its code |
| Host | The person who created the room |
| Guest | Anyone else in the room |
| Queue | The songs and stations waiting to play, in order |
| Listening | A device that is playing the room's audio |
| Voice note | A recorded message of up to 20 seconds |

The app never says "user", "peer", "session" or "sync".

## 3. Who you are

There are no accounts.

| Field | Rule |
| --- | --- |
| Name | 2 to 20 characters, asked once, remembered on the device, editable from the room |
| Colour | Given automatically from eight set colours, by order of joining |
| Device identity | A random ID created on first use and kept on the device; never shown |

If two people pick the same name, the second is shown as "Sam 2".

## 4. The room

| Field | Rule |
| --- | --- |
| Code | 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O, 1, I or L, so it can be read aloud) |
| Link | `iradio.idexa.app/r/K7M2QX` |
| QR code | Encodes the link; shown on the share sheet |
| Name | Optional, up to 30 characters; default "Sam's room" |
| People | Up to 50 at once |
| Typing a code | Not case sensitive; spaces and dashes ignored |

### Lifetime

| Event | Result |
| --- | --- |
| Everyone has left | The room closes after 30 minutes |
| Room reaches 24 hours old | It closes |
| Host taps **End room** and confirms | It closes at once for everyone |
| A closed room's code is used | "This room has ended" |

When a room closes, its queue and voice notes are deleted.

### Settings (host only)

| Setting | Choices | Default |
| --- | --- | --- |
| Who can add songs | Everyone / Host only | Everyone |
| Who can send voice notes | Host only / Selected people / Everyone | Selected people |
| Approve voice notes first | On / Off | Off |
| Lock room (no new people) | On / Off | Off |

## 5. What each person can do

| Action | Host | Guest |
| --- | --- | --- |
| Add a song or station | Yes | If the setting allows |
| Remove an item | Any | Their own, while it waits |
| Reorder the queue | Yes | No |
| Skip the current item | At once | By vote |
| Pause and resume for everyone | Yes | No |
| Listen on their own device | Yes (on by default) | Yes (off by default) |
| Change their own volume | Yes | Yes |
| Send a voice note | Yes | If allowed |
| Ask for the mic | n/a | Yes, when set to Selected people |
| Allow or stop someone's voice notes | Yes | No |
| Remove a person | Yes | No |
| Change settings, end the room | Yes | No |
| Hand hosting to someone | Yes | No |

### If the host leaves

1. Music keeps playing for everyone who is listening.
2. After 60 seconds without the host, the guest who has been in the room
   longest becomes host, and everyone sees "Maya is now the host".
3. If the original host comes back while the room is open, they become host
   again, and the stand-in sees "Sam is back as host".

A removed person cannot rejoin that room from the same device.

## 6. The queue

### What can be queued

| Kind | Source | Ends when | Waveform in the visual |
| --- | --- | --- | --- |
| Song | A YouTube link | The video finishes | No (ambient swell) |
| Song | A SoundCloud link **[prove]** | The track finishes | No (ambient swell) |
| Audio | A direct link to an audio file (MP3, AAC, Ogg) | The file finishes | Yes, where the file's host allows it |
| Station | Any station from iRadio's own lists | Someone skips it | Yes, as today |

Considered and left out, because each listener would need a paid
subscription and a login: Spotify (and its developer rules now shut out new
public apps) and Apple Music (which also costs you a yearly developer fee).
Uploading files stays out: it would put audio on your server.

### Adding

| Way | How |
| --- | --- |
| Paste a link | The add sheet has one field for any accepted link; the clipboard's link is offered if it is one |
| Share from YouTube | On Android, the installed app appears in YouTube's share menu **[prove]** |
| Add a station | Every station card gains **Add to room** while you are in a room |

Accepted links:

| Source | Forms |
| --- | --- |
| YouTube | `youtube.com/watch`, `youtu.be`, `music.youtube.com/watch`, `m.youtube.com/watch`, `youtube.com/shorts`. A playlist link adds only the one video it points at |
| SoundCloud | `soundcloud.com/<artist>/<track>` and `on.soundcloud.com` short links. Sets (playlists) are not accepted |
| Audio file | Any `https://` link ending in `.mp3`, `.m4a`, `.aac`, `.ogg` or `.opus`, or that answers as audio |

After a link is pasted the sheet shows the title and thumbnail before
**Add** is enabled, so nothing is added blind. The title, length and whether
the video can be embedded are read on the adder's own device from YouTube's
player; the server is not involved.

### Rules

| Rule | Number |
| --- | --- |
| Items one person may have waiting | 5 |
| Items waiting in total | 100 |
| Longest song | 15 minutes |
| Same song waiting twice | Not allowed |
| Live videos | Not allowed |
| Videos or tracks that block embedding | Rejected when added if known, otherwise skipped when reached |
| Audio files that cannot be jumped to a position | Not allowed; a device joining late could not catch up |

### Order

Turns rotate so one person cannot fill the queue:

- Everyone's first waiting item plays before anyone's second, and so on.
- Within the same turn, earlier additions go first.
- When the host drags an item, it stays exactly where it was put.

### Skipping

- The host skips at once.
- A guest's **Skip** is a vote. The item is skipped when more than half the
  people in the room have voted, with a minimum of two votes. Votes reset
  with each item.

### History

The last 20 played items are kept in the room, each with who added it. Any
of them can be added again.

## 7. Playing and listening along

The room keeps one timeline: which item is playing and the moment it
started. Devices follow the timeline; no device is the source of truth, so
the host's phone losing signal does not stop the room.

### States of the room

| State | Meaning | Shown as |
| --- | --- | --- |
| Empty | Nothing queued | "Drop the first song" |
| Starting | Next item loads; starts in 3 seconds | Title with a countdown ring |
| Playing | An item is playing | Title, who added it, progress |
| Paused | Host paused | "Paused by Sam" |
| Voice note | A note is playing over or between items | The sender's name and a waveform |

### Listening on a device

- The host's device listens by default.
- A guest taps **Listen here**. The tap is required: browsers will not start
  sound without one. The device then joins at the current position.
- **Stop listening** silences that device only.
- Volume is per device and never affects anyone else.
- Entering a room stops any radio that device was playing. Leaving the room
  does not restart it.

### Keeping devices together

| Step | Number |
| --- | --- |
| Clock check on joining | 5 measurements against the Worker's time route; the quickest is used. (Cloudflare's own time endpoint was tried and reports whole seconds only) |
| Clock re-check | Every 2 minutes |
| Position check while playing | Every second, worked out on the device with no message to the room |
| Correction | Within 40 ms: left alone. Up to 1 second: closed by briefly playing slightly faster or slower. Beyond that: a jump, aimed ahead by the time this device's jumps take |
| Head start for each item | 3 seconds, so every device has loaded before it begins |

Expected result: devices within about half a second of each other
**[prove]**. In separate places this is unnoticeable. Two phones side by
side will echo slightly; the app does not claim otherwise.

### When things go wrong on one device

| Situation | That device | Everyone else |
| --- | --- | --- |
| YouTube shows an ad | "Catching up", then jumps to the right place | Unaffected |
| Video not available in that country | "Not available on this device" | Unaffected |
| Video cannot play on the host's device | n/a | Item is skipped, marked "Could not play" |
| Connection drops | "Reconnecting", retrying after 1, 2, 4, 8 then every 15 seconds | Unaffected |

### The picture

YouTube requires its player to be visible, at least 200 by 200. In a room
the stage shows the video where the artwork disc normally sits. SoundCloud
likewise requires its player to be shown. An audio file shows the artwork
disc with the adder's colour. The ripples
behind it move in the ambient swell, because YouTube's audio cannot be read.
For a station item the ripples show the real waveform as they do today.

## 8. Voice notes

### Sending

1. Hold the mic button to record. The button shows the seconds and a level.
2. Release. The note is kept on the device, not sent.
3. Preview: play it back, then **Send**, **Record again** or **Discard**.
4. Choose **Play now** (default) or **After this song**.

| Rule | Number |
| --- | --- |
| Longest note | 20 seconds; recording stops by itself |
| Shortest note | 1 second; anything shorter is discarded with "Hold to record" |
| Notes per person | 1 per 60 seconds |
| Notes waiting | 5 in total |

### Playing

| Situation | What happens |
| --- | --- |
| Play now | Music fades to 15% over 0.5 seconds, the note plays, music returns over 0.8 seconds |
| After this song | The note plays in the gap before the next item's head start |
| Play now, with under 8 seconds of the song left | The note waits for the gap instead |
| Several notes | They play one after another, never together |
| Someone joins while a note plays | They hear the music only, not half a note |
| Room is paused | Notes wait until it resumes |
| Nothing is playing | The note plays straight away |

Every listening device plays a note at the same moment, with the sender's
name and colour on screen. A device that is not listening shows the note in
the room's activity with a play button.

### Who may send

| Setting | Guests see |
| --- | --- |
| Host only | No mic button |
| Selected people | **Ask for the mic**; after asking, "Waiting for Sam"; once allowed, the mic button |
| Everyone | The mic button |

With **Approve voice notes first** on, a sent note goes to the host, who
plays it privately and taps **Play for everyone** or **Discard**. The sender
sees "Waiting for Sam to approve", then "Played" or "Not played".

The host can stop anyone's voice notes from the people list at any time.

### Storage

A note is about 80 KB. It is held by the room and deleted when the room
closes. Notes are never public and have no link.

Phones record in different formats (iPhone and Android differ) and each must
play the other's **[prove]**.

## 9. Screens and their states

| Screen | States |
| --- | --- |
| **Rooms** (new rail item) | Not in a room: **Create a room**, and a code field with **Join**. In a room: goes straight to it |
| **Your name** | First time only; field, **Continue** disabled until 2 characters |
| **Joining** | Loading; "No room with that code"; "This room has ended"; "This room is locked"; "This room is full"; "You were removed from this room" |
| **Room** | Empty; starting; playing; paused; voice note playing; reconnecting; ended |
| **Queue** (part of Room) | Empty; waiting items with who added each; your own items removable; host can drag |
| **People** (sheet) | List with colour, name, host badge, listening mark; host sees the per-person actions |
| **Add** (sheet) | Empty field; checking link; preview with **Add**; each rejection in section 6 |
| **Voice note** (sheet) | Asking for mic permission; permission refused; recording; preview; sending; waiting for approval; rate-limited with the seconds left |
| **Share** (sheet) | Code in large type, **Copy link**, QR code, the system share button |
| **Settings** (sheet, host) | The four settings, **Hand over hosting**, **End room** |

A control that cannot be used is shown disabled with its reason, never left
to fail. Examples: **Add** shows "You have 5 songs waiting"; the mic shows
"You can send another in 42 s".

## 10. The exact words

| Where | Words |
| --- | --- |
| Rooms, not in one | "Listen together" / "Create a room and share the code. Everyone adds songs to one queue." |
| Create button | "Create a room" |
| Join field | "Room code" / **Join** |
| Empty queue | "Drop the first song" / "Paste a link or add a station." |
| Guest, not listening | **Listen here** |
| Guest, listening | **Stop listening** |
| Starting | "Up next" |
| Added by | "Added by Maya" |
| Skip vote | "Skip · 2 of 4" |
| Host change | "Maya is now the host" |
| Host back | "Sam is back as host" |
| Removed | "You were removed from this room" |
| Ended | "This room has ended" |
| Leave | "Leave room" / "You can rejoin with the code." |
| End room confirm | "End this room for everyone?" / **End room** / **Keep it open** |
| Mic refused | "iRadio cannot use the microphone. Allow it in your browser's settings to send voice notes." |
| Link not recognised | "Paste a YouTube, SoundCloud or audio link" |
| SoundCloud set | "Add one track at a time" |
| Audio cannot seek | "That file cannot be played in a room" |
| Too long | "Songs can be up to 15 minutes" |
| Duplicate | "That song is already in the queue" |
| Live video | "Live videos cannot be queued" |
| Own limit | "You have 5 songs waiting" |
| Queue full | "The queue is full" |

## 11. What the room remembers

| Thing | Fields |
| --- | --- |
| Room | code, name, created time, host, the four settings, state, closed or not |
| Person | device ID (private), name, colour, joined time, present or not, listening or not, may send voice notes, removed or not |
| Queue item | ID, kind, YouTube ID or station, title, thumbnail, length, added by, added time, turn number, pinned position if dragged, skip votes |
| Timeline | current item, start moment, paused position if paused |
| Voice note | ID, sender, length, recorded time, when to play, approval state, the audio |
| History | The last 20 played items |

## 12. Keeping the server small

A standing rule for this feature: the server does as little as possible.

| Job | Done by |
| --- | --- |
| Playing music | YouTube and the broadcaster, straight to each device |
| Reading a song's title, length and embeddability | The adder's device |
| Song thumbnails | YouTube's image addresses, loaded by each device |
| Staying in step during a song | Each device, from the timeline it already has |
| Clock checks | The Worker's time route: 5 tiny requests on joining, then 5 every 5 minutes |
| QR code | Drawn on the device |
| Fading music for a voice note | Each device |
| Holding the queue, the timeline and who is present | The room (server) |
| Passing on changes: joins, adds, skips, votes, settings | The room (server) |
| Holding and handing out voice notes | The room (server) |

So the room only hears from a device when a person does something. A device
that is just listening sends nothing. The room sleeps between messages
rather than staying awake for the length of the party.

Cloudflare does not charge for bandwidth on Workers. What it counts is
requests and how long a room is awake, which is what this table keeps low.

Voice notes are the only audio that passes through the server: about 80 KB
each, once in and once out per listening device.

## 13. Cost

| Part | Service | Cost |
| --- | --- | --- |
| Rooms and live updates | Cloudflare Durable Objects | Included in the free plan **[prove limits]** |
| Songs | YouTube's embedded player | None; audio never touches your server |
| Voice notes | Stored with the room | Negligible: 1,000 notes is about 80 MB, deleted as rooms close |

Nothing in this plan needs a paid plan or a paid service.

## 14. To prove in phase 2, before any design

Each is a small throwaway test on your iPhone and an Android phone.

| # | Question | Passes when |
| --- | --- | --- |
| 1 | Does YouTube's player start, seek and stay in step in iPhone Safari and in the installed app? | Two phones stay within 0.5 seconds for a full song |
| 2 | Does a tap on **Listen here** reliably unlock sound on iPhone? | Sound starts on the first tap, ten times out of ten |
| 3 | Can a voice note recorded on iPhone play on Android, and the reverse? | Both directions play |
| 4 | Does the microphone work in the installed iPhone app? | Permission is asked once and recording works |
| 5 | Can the music be faded while a note plays, on iPhone? | The fade is audible; iPhone ignores some volume controls |
| 6 | Does a room hold 50 connections on the free plan? | 50 simulated people stay connected for an hour |
| 7 | Does sharing from the YouTube app reach the installed iRadio on Android? | The link arrives in the add sheet |
| 8 | Is Cloudflare's time endpoint accurate and quick enough to line devices up? | Two phones agree to within 0.1 seconds |
| 9 | Can a device read a video's title, length and embeddability by itself? | All three are known before **Add** is enabled |
| 10 | Does SoundCloud's player start, seek and stay in step on iPhone and Android? | Same bar as test 1. If it fails, SoundCloud is dropped and YouTube stands alone |
| 11 | Can the app tell, before adding, that an audio file can be jumped to a position? | A seekable file is accepted and a non-seekable one is refused |

Number 5 is the one most likely to fail. If iPhone will not let the app
lower YouTube's volume, the fallback to decide then is pausing the song for
the length of the note instead of fading it.

## 15. Hosting

Decided 2026-10-12.

| Question | Answer |
| --- | --- |
| Cloudflare account | A separate account named **iRadio**, which you create |
| Address until a domain is bought | The one Cloudflare assigns: `iradio.<account-name>.workers.dev` |
| What is deployed there | The whole app, site and rooms together |
| `iradio.idexa.app` | Left running as it is, because someone is using it. It is no longer deployed to; you will delete it yourself later |
| A bought domain, later | Attached to the same Worker in the iRadio account; nothing is rebuilt |

The whole app goes to the one account, not only the rooms server, so the
site and the rooms stay on one address. Splitting them would mean the site
on one address talking to rooms on another, for no gain.

Two consequences of starting on the assigned address and changing later:

- **Installed apps do not follow a change of address.** Anyone who installs
  from the `workers.dev` address has to install again from the new domain.
- **Saved stations and names are kept per address**, so they do not carry
  over either.

So the assigned address suits building and testing. Buy the domain before
inviting real listeners, or they will have to start again.

## 16. Decisions made here, and why

| Decision | Why |
| --- | --- |
| Songs come from YouTube links (confirmed by you) | Largest catalogue, free, seekable, and no audio on your server |
| SoundCloud and direct audio links are added | You asked for any other feasible source; these two need no login and no payment |
| Spotify and Apple Music are left out | Every listener would need a paid subscription and a login |
| No in-app song search | YouTube's free allowance is about 100 searches a day, which a single busy room would use up |
| The room owns the timeline, not the host's phone | Otherwise the host's signal dropping would stop everyone |
| Recorded voice notes, not live voice | Your choice; it also removes the only paid service and two iPhone risks |
| Turns rotate in the queue | So one person cannot fill it |
| No accounts | A code is enough to join, and it keeps joining to one step |
| Rooms close when empty for 30 minutes | Nothing is kept longer than it is used |
| Devices do the work wherever they can | Your rule: lean on the server as little as possible |

## 17. Still yours to decide

Nothing blocks phase 2. One question is left for phase 3:

1. **Whether rooms should be reachable from the main screen on phones**, where the four tabs are already full: a fifth tab, or a button on the stage.

# iRadio

[![License: MIT](https://img.shields.io/badge/license-MIT-ffb454)](LICENSE)
[![CI](https://github.com/nafishahmeddev/iradio/actions/workflows/ci.yml/badge.svg)](https://github.com/nafishahmeddev/iradio/actions/workflows/ci.yml)

Browse the world. Tune in. See the sound.

Internet radio from every country, in the browser. Around the station's artwork
a WebGL scene draws ripples, each one the stream's real waveform from a moment
ago. It installs as an app on phones and desktops.

## How it is built

| Part | What | Where |
| --- | --- | --- |
| Site | [Astro](https://astro.build/), built to static files; no UI framework | `src/` |
| API | [Hono](https://hono.dev/) on a Cloudflare Worker: station search, and rooms on Durable Objects | `worker/` |
| Hosting | Cloudflare serves the static files itself; only `/api/*` runs the Worker | `wrangler.jsonc` |
| Audio | Plays straight from each broadcaster, so listening uses none of your bandwidth | `src/scripts/player.ts` |

## Run

Requires Node 22 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:4321. `npm run dev` builds once, then runs the site with
live reload and the Worker beside it on port 8787; the site passes `/api`
requests to the Worker.

`npm run preview` serves the production build exactly as Cloudflare will,
service worker included, on http://localhost:8787.

## Deploy to Cloudflare

Connect the repository under **Workers & Pages → Create → Import a repository**
and set:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Every push then builds and deploys on Cloudflare. To deploy from your own
machine instead: `npx wrangler login` once, then `npm run deploy`.

The build downloads the second station catalogue and writes it into the site
as about 1,300 small files, so it needs network access (Cloudflare's builds
have it).

## Where stations come from

One search, two catalogues, tried in order:

| Catalogue | What it is | Role |
| --- | --- | --- |
| [Radio Browser](https://www.radio-browser.info/) | Community directory with a live API; ranks by listener votes. Mirrors are discovered from its DNS records, with failover. | First choice |
| [International Public Radio Directory](https://github.com/iprd-org/iprd) | Curated, MIT-licensed list of about 25,000 stations in 225 countries, published as one 18 MB file. | Used whenever Radio Browser does not answer |

A Worker cannot search an 18 MB file on each request, so the build splits it
into shards: one per country, one per two-letter prefix of station names and
of genres, and a "world tour". A search reads the single shard that can hold
its answer. A name search therefore matches from the start of a word
("classica" finds "Rádio Clássica"; "assica" does not).

Browsing is the same whichever catalogue answers: every country grouped by
continent, a genre picker, search by name, and saved stations.

## How audio plays

1. **Direct, readable.** Most broadcasters let other sites read their audio
   (CORS). The stream runs through the Web Audio graph: the ripples carry the
   real waveform, and the boost control works.
2. **Direct, private.** The station plays, but the browser keeps its samples
   from the page. The ripples move in a slow, even swell that is plainly not
   the audio, and boost is disabled with the reason shown.

On an `https://` page a browser will not load `http://` audio, so searches
leave those stations out rather than list what cannot play.

## Rooms

Listen together. One person creates a room and shares its code, link or QR
code; everyone adds songs to one queue, and any device can choose to play
along in step.

- **Songs** come from YouTube, SoundCloud or direct audio links, and any radio
  station in the app can be queued too. Audio plays from the source on each
  device; none of it passes through the server.
- **The room owns the timeline**, not the host's phone, so the host losing
  signal does not stop the music. Devices line up on a shared clock and
  stay within a few hundredths of a second of each other: small gaps are
  closed by briefly playing slightly faster or slower, large ones by a jump.
- **Fades.** Each song eases in and out, a device joining mid-song stays
  silent until it is in step and then fades in, and no change of loudness is
  ever abrupt.
- **Voice notes**: hold to record up to 20 seconds, listen back, send. The
  music fades while a note plays.
- **The server** is one Cloudflare Durable Object per room (`worker/room.ts`).
  It sleeps between messages. Every rule lives in `src/lib/rooms/room.ts` as a
  plain function with tests.

The plan and architecture are in [docs/rooms-plan.md](docs/rooms-plan.md) and
[docs/rooms-architecture.md](docs/rooms-architecture.md).

## Installed app

The site is a Progressive Web App. Android and desktop Chrome offer **Install**
(an install button also appears in the app when the browser allows it); on
iPhone use **Share → Add to Home Screen**. A service worker keeps the app's
own files, so it opens instantly and still opens offline; station search and
audio always need a connection. Saved stations and volume are kept in the
browser.

## Keyboard

| Key | Action |
| --- | --- |
| ← → ↑ ↓ | Browse stations |
| Enter | Tune in |
| Space | Pause / resume |
| + − | Volume |
| / | Search by name |
| C · G · B · T | Countries · Genres · Saved · Top |
| F | Save / remove the selected station |
| [ ] | Previous / next page |
| S | Stop |
| ? | Show all shortcuts |

Start-up options: `/?country=IN&search=jazz&volume=60&gain=6`.

## Layout

```text
src/
  pages/                  index.astro (the app), 404.astro
  components/             Rail, Stage, Browser, PlayerBar, Dialog, Slider, Icon, Logo
  styles/tokens.css       Design tokens; the WebGL scene reads its colours here
  lib/                    Pure logic shared by the site, the Worker and the tests
  scripts/                app.ts (interface), player.ts (audio), scene.ts (WebGL)
worker/                   index.ts (Hono app), stations.ts, radio-browser.ts
scripts/                  build-catalogue.ts (run by the build), build-icons.mjs
public/                   manifest, service worker, icons, cache headers
tests/                    Offline tests
```

## Develop

```sh
npm run check        # types, including .astro files and the Worker
npm test
npm run build
```

## Credits and license

Designed and developed by [Idexa](https://idexa.app).

Licensed under the [MIT License](LICENSE). Station data:
[Radio Browser](https://www.radio-browser.info/) and the
[International Public Radio Directory](https://github.com/iprd-org/iprd) (MIT).
Icons: [Phosphor](https://phosphoricons.com/) (MIT). Type:
[Instrument Sans](https://github.com/Instrument/instrument-sans) (OFL). The license covers
this repository's code; it grants no rights to third-party broadcasts.

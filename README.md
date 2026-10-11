# iRadio for the web

Internet radio from all over the world, with the sound drawn live: a grainy
WebGL scene where ripples leave the dial, each one the station's real waveform
from a moment ago.

Built with [Astro](https://astro.build/). The page is prerendered HTML with no
UI framework. Audio plays straight from each broadcaster, so listening costs
this server no bandwidth; the server only answers station searches.

## Run

Requires Node 22 or newer.

```sh
cd web
npm install
npm run dev          # http://localhost:4321
```

Production:

```sh
npm run build
npm start            # HOST and PORT are read from the environment
```

Start-up options mirror the CLI flags:
`/?country=IN&search=jazz&volume=60&gain=6`.

## Where stations come from

One search, two catalogues, tried in order:

| Catalogue | What it is | Role |
| --- | --- | --- |
| [Radio Browser](https://www.radio-browser.info/) | Community directory with a live API; ranks by listener votes. Mirrors are discovered from its DNS records, with failover. | First choice |
| [International Public Radio Directory](https://github.com/iprd-org/iprd) | Curated, MIT-licensed catalogue of about 25,000 stations in 225 countries, published as a file on static hosting. Loaded into memory, refreshed daily, copied to disk for restarts. | Used whenever Radio Browser does not answer |

Browsing is organised the same way whichever one answers: every country,
grouped by continent with a filter; a genre picker; search by name; saved
stations. Without a popularity ranking the second catalogue shows "Around the
world", the best-documented stations of each country in turn.

## How audio plays

Each station is tried in this order:

1. **Direct, readable.** Most broadcasters allow other sites to read their
   audio (CORS). The stream runs through the Web Audio graph: the ripples
   carry the real waveform, and the boost control works.
2. **Direct, private.** The station plays, but the browser keeps its samples
   from the page. The ripples move in a slow, even swell that is plainly not
   the audio, and boost is disabled with the reason shown.
3. **Relay (off by default).** Build with `PUBLIC_STREAM_RELAY=fallback` and a
   station that cannot play directly is fetched through `/api/stream`. That
   spends this server's bandwidth, about 58 MB per listener-hour at 128 kbps.
   The relay only fetches public addresses, only passes audio through, and
   refuses requests from other sites.

On an `https://` page a browser will not load `http://` audio. With the relay
off, searches leave those stations out rather than list what cannot play.

## Differences from the terminal app

- Saved stations and volume are kept in the browser's `localStorage`; favorites
  in `~/.haaki_radio_favorites.json` are not imported.
- Audio plays on the system's default output. `--output` and `--device` have
  no equivalent.
- Resuming after a pause longer than 15 seconds rejoins the live broadcast.

## Layout

```text
src/
  pages/index.astro       The page and its dialogs
  pages/api/              stations.ts (search), stream.ts (optional relay)
  components/             Rail, Stage, Browser, PlayerBar, Dialog, Slider, Icon
  styles/tokens.css       Design tokens; the WebGL scene reads its colours here
  lib/                    Pure logic shared by server, client and tests
  server/                 radio-browser.ts, catalogue.ts, stations.ts, relay.ts
  scripts/                app.ts (interface), player.ts (audio), scene.ts (WebGL)
tests/                    Offline tests; the relay is tested against local servers
```

## Develop

```sh
npm run check        # types, including .astro files
npm test
npm run build
```

## Credits

Icons: [Phosphor](https://phosphoricons.com/) (MIT). Type: [Archivo](https://github.com/Omnibus-Type/Archivo) (OFL).
Station data: [Radio Browser](https://www.radio-browser.info/) and the
[International Public Radio Directory](https://github.com/iprd-org/iprd) (MIT).
The iRadio license covers this code, not third-party broadcasts.

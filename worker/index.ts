/**
 * The iRadio API, a Hono app on Cloudflare Workers. The site itself is static
 * files served by Cloudflare; only /api/* reaches this code (see wrangler.jsonc).
 */

import { Hono } from 'hono';
import { cache } from 'hono/cache';

import { makeCode, tidyCode } from '../src/lib/rooms/code';
import { isCountryCode, type StationQuery } from '../src/lib/stations';
import { findStations, providers, SOURCES, type Assets, type Source } from './stations';

/** A room's Durable Object, reached by its code. Typed structurally so this file needs no Cloudflare types. */
interface Rooms {
  idFromName: (name: string) => unknown;
  get: (id: never) => { fetch: (request: Request) => Promise<Response> };
}

interface Bindings {
  ASSETS: Assets;
  ROOMS: Rooms;
}

const CODE_ATTEMPTS = 5;

const app = new Hono<{ Bindings: Bindings }>();

function parseQuery(params: URLSearchParams): StationQuery | null {
  const query: StationQuery = {};
  for (const field of ['name', 'tag'] as const) {
    const value = params.get(field)?.trim();
    if (!value) continue;
    if (value.length > 100) return null;
    query[field] = value;
  }
  const country = params.get('countrycode');
  if (country) {
    if (!isCountryCode(country)) return null;
    query.countrycode = country.toUpperCase();
  }
  return query;
}

app.get(
  '/api/stations',
  // The same search from the same place is answered from Cloudflare's cache for a few minutes.
  cache({ cacheName: 'iradio-stations', cacheControl: 'public, max-age=300' }),
  async (c) => {
    const params = new URL(c.req.url).searchParams;
    const query = parseQuery(params);
    const offset = Number(params.get('offset') ?? 0);
    const source = params.get('source');
    if (
      !query ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1_000_000 ||
      (source !== null && !SOURCES.includes(source as Source))
    ) {
      return c.json({ error: 'Invalid station search' }, 400);
    }
    try {
      const found = await findStations(
        providers(c.env.ASSETS),
        query,
        offset,
        params.get('secure') === '1',
        (source as Source | null) ?? undefined,
      );
      return c.json(found);
    } catch (error) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  },
);

// The clock every device in a room sets itself by.
app.get('/api/time', (c) => c.json({ now: Date.now() }, 200, { 'Cache-Control': 'no-store' }));

/**
 * The room server could not be reached at all, for instance when the account's
 * daily allowance is used up. Said plainly, so the app can tell people.
 */
function unavailable(c: { json: (body: unknown, status: 503) => Response }, cause?: unknown): Response {
  // People are told only that rooms are unavailable; the reason goes to the log for whoever runs the site.
  console.error('Room server unreachable:', cause instanceof Error ? cause.message : String(cause ?? 'no free code found'));
  return c.json({ error: 'unavailable' }, 503);
}

const room = (rooms: Rooms, code: string) => rooms.get(rooms.idFromName(code) as never);

// A new room: draw a code and claim it; on the rare clash, draw again.
app.post('/api/rooms', async (c) => {
  const params = new URL(c.req.url).searchParams;
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = makeCode();
    const target = new URL(`/api/rooms/${code}/create?${params}`, c.req.url);
    try {
      const response = await room(c.env.ROOMS, code).fetch(new Request(target, { method: 'POST' }));
      if (response.status !== 409) return response;
    } catch (cause) {
      return unavailable(c, cause);
    }
  }
  return unavailable(c);
});

// Everything else about a room goes to its own object: the live connection and voice notes.
app.all('/api/rooms/:code/*', (c) => {
  const code = tidyCode(c.req.param('code'));
  if (!code) return c.json({ error: 'none' }, 404);
  // The live connection must come from this app's own pages, not another site.
  const origin = c.req.header('Origin');
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: 'forbidden' }, 403);
  return room(c.env.ROOMS, code)
    .fetch(c.req.raw)
    .catch((cause: unknown) => unavailable(c, cause));
});

// A room's link opens the app itself; the app reads the code from the address.
app.get('/r/*', (c) => c.env.ASSETS.fetch(new URL('/', c.req.url)));

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

export default app;

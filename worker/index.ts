/**
 * The iRadio API, a Hono app on Cloudflare Workers. The site itself is static
 * files served by Cloudflare; only /api/* reaches this code (see wrangler.jsonc).
 */

import { Hono } from 'hono';
import { cache } from 'hono/cache';

import { isCountryCode, type StationQuery } from '../src/lib/stations';
import { findStations, providers, SOURCES, type Assets, type Source } from './stations';

interface Bindings {
  ASSETS: Assets;
}

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

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

export default app;

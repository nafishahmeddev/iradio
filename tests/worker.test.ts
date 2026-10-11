import { describe, expect, it, vi } from 'vitest';

import app from '../worker/index';
import { discoverServers, searchRadioBrowser } from '../worker/radio-browser';
import { findStations, searchCatalogue, type Assets, type Provider } from '../worker/stations';

const station = { name: 'One', url: 'https://one.example', country: '', countrycode: 'FR', bitrate: 0, tags: 'jazz' };

describe('radio browser', () => {
  const body = [{ name: 'Good', url: 'https://example.com' }, { name: 'Bad' }];

  it('finds mirrors through DNS over HTTPS and always keeps the known ones', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({ Answer: [{ data: '0 0 443 fi9.api.radio-browser.info.' }, { data: '0 0 443 evil.example.' }] }),
    );
    expect(await discoverServers(request as unknown as typeof fetch, Date.now() + 1e9)).toEqual([
      'fi9.api.radio-browser.info',
      'de1.api.radio-browser.info',
      'de2.api.radio-browser.info',
    ]);
  });

  it('fails over to the next server and filters unplayable stations', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(Response.json(body));
    const stations = await searchRadioBrowser({ name: 'jazz' }, 50, true, {
      servers: async () => ['a.example', 'b.example', 'c.example'],
      fetch,
    });
    expect(stations.map((found) => found.name)).toEqual(['Good']);
    const url = new URL(fetch.mock.calls[2]![0]);
    expect(url.host).toBe('c.example');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      name: 'jazz',
      codec: 'MP3',
      order: 'votes',
      limit: '50',
      offset: '50',
      is_https: 'true',
    });
  });

  it('reports the failure when every server is down', async () => {
    await expect(
      searchRadioBrowser({}, 0, false, {
        servers: async () => ['a.example'],
        fetch: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).rejects.toThrow('Radio Browser is not answering: offline');
  });
});

describe('station search across catalogues', () => {
  const provider = (source: Provider['source'], search: Provider['search']): Provider => ({ source, search });

  it('falls back to the second catalogue when the first fails', async () => {
    const second = vi.fn().mockResolvedValue([station]);
    const found = await findStations(
      [provider('radio-browser', vi.fn().mockRejectedValue(new Error('down'))), provider('iprd', second)],
      { tag: 'jazz' },
      0,
      true,
    );
    expect(found).toEqual({ stations: [station], source: 'iprd' });
    expect(second).toHaveBeenCalledWith({ tag: 'jazz' }, 0, true);
  });

  it('keeps later pages on the catalogue the list came from', async () => {
    const first = vi.fn().mockResolvedValue([]);
    const found = await findStations(
      [provider('radio-browser', first), provider('iprd', vi.fn().mockResolvedValue([station]))],
      {},
      50,
      false,
      'iprd',
    );
    expect(found.source).toBe('iprd');
    expect(first).not.toHaveBeenCalled();
  });

  it('reports every failure when no catalogue answers', async () => {
    await expect(
      findStations(
        [
          provider('radio-browser', vi.fn().mockRejectedValue(new Error('first down'))),
          provider('iprd', vi.fn().mockRejectedValue(new Error('second down'))),
        ],
        {},
        0,
        false,
      ),
    ).rejects.toThrow('first down; second down');
  });
});

describe('catalogue shards as static files', () => {
  const assets = (files: Record<string, unknown>): Assets => ({
    fetch: async (input) => {
      const { pathname } = new URL(String(input instanceof Request ? input.url : input));
      return pathname in files ? Response.json(files[pathname]) : new Response('missing', { status: 404 });
    },
  });

  it('reads the shard a search points at', async () => {
    const files = assets({ '/catalogue/country/FR.json': [station] });
    expect(await searchCatalogue(files, { countrycode: 'fr' }, 0, false)).toEqual([station]);
    expect(await searchCatalogue(files, { countrycode: 'fr' }, 50, false)).toEqual([]);
  });

  it('treats a missing shard as no stations, not as a failure', async () => {
    expect(await searchCatalogue(assets({}), { countrycode: 'zz' }, 0, false)).toEqual([]);
  });
});

describe('the API', () => {
  const env = {
    ASSETS: { fetch: async () => Response.json([station]) } satisfies Assets,
  };

  it('rejects searches it cannot run', async () => {
    for (const path of ['/api/stations?countrycode=XYZ', '/api/stations?offset=-1', '/api/stations?source=other']) {
      expect((await app.request(path, {}, env)).status, path).toBe(400);
    }
  });

  it('answers from the named catalogue', async () => {
    const response = await app.request('/api/stations?countrycode=FR&source=iprd', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stations: [station], source: 'iprd' });
  });

  it('has nothing else under /api', async () => {
    expect((await app.request('/api/stream', {}, env)).status).toBe(404);
  });
});

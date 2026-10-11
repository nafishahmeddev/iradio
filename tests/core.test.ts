import { describe, expect, it } from 'vitest';

import { Favorites, FAVORITES_KEY } from '../src/lib/favorites';
import { duration } from '../src/lib/format';
import { dbToAmplitude, HEADROOM, softClip, softClipCurve } from '../src/lib/gain';
import { parseOptions, readSettings } from '../src/lib/options';
import { stationId, toStation, toStations, type Station } from '../src/lib/stations';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const station = (name: string, url: string): Station => toStation({ name, url })!;

describe('favorites', () => {
  it('round-trips and identifies stations by address', () => {
    const store = memoryStore();
    const favorites = new Favorites(store);
    const first = station('One', 'https://one.example');
    const second = station('Two', 'https://two.example');
    expect(favorites.toggle(first)).toBe(true);
    expect(favorites.toggle(second)).toBe(true);
    expect(favorites.toggle(first)).toBe(false);
    expect(new Favorites(store).stations).toEqual([second]);
  });

  it('keeps unreadable data and reports it', () => {
    const store = memoryStore({ [FAVORITES_KEY]: '{"bad": true}' });
    const favorites = new Favorites(store);
    expect(favorites.stations).toEqual([]);
    expect(favorites.warning).not.toBe('');
    expect(store.data.get(FAVORITES_KEY)).toBe('{"bad": true}');
  });

  it('does not change memory when saving fails', () => {
    const favorites = new Favorites({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(() => favorites.toggle(station('One', 'https://one.example'))).toThrow();
    expect(favorites.stations).toEqual([]);
  });
});

describe('stations', () => {
  it('drops records that cannot be played', () => {
    const stations = toStations([
      { name: 'Good', url: 'https://example.com' },
      { name: 'Bad' },
      { name: 'Script', url: 'javascript:alert(1)' },
      'nonsense',
    ]);
    expect(stations.map((s) => s.name)).toEqual(['Good']);
  });

  it('prefers the resolved address and cleans untrusted text', () => {
    const cleaned = toStation({
      name: 'Radio\u0007 One\n',
      url: 'http://playlist.example/a.pls',
      url_resolved: 'http://stream.example/a',
      countrycode: 'in',
      bitrate: '128',
      tags: 'jazz,blues',
      stationuuid: 'abc',
      favicon: 'https://stream.example/logo.png',
    })!;
    expect(cleaned).toMatchObject({
      name: 'Radio  One',
      url: 'http://stream.example/a',
      countrycode: 'IN',
      bitrate: 128,
      tags: 'jazz, blues',
      logo: 'https://stream.example/logo.png',
    });
    expect(toStation({ url: 'https://a.example', favicon: 'http://a.example/logo.png' })).not.toHaveProperty('logo');
    expect(stationId(cleaned)).toBe('abc');
  });

  it('rejects a response that is not a list', () => {
    expect(() => toStations({ error: true })).toThrow();
  });
});

describe('text helpers', () => {
  it('formats elapsed time', () => {
    expect(duration(0)).toBe('00:00');
    expect(duration(65.9)).toBe('01:05');
    expect(duration(3725)).toBe('01:02:05');
    expect(duration(-5)).toBe('00:00');
  });

});

describe('preamp', () => {
  it('leaves quiet audio untouched and never exceeds full scale', () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(-0.5)).toBe(-0.5);
    expect(softClip(4)).toBeLessThanOrEqual(1);
    expect(softClip(4)).toBeGreaterThan(softClip(1));
    expect(softClip(-4)).toBe(-softClip(4));
  });

  it('builds a curve that spans the preamp headroom', () => {
    const curve = softClipCurve(4097);
    expect(HEADROOM).toBeCloseTo(dbToAmplitude(12));
    expect(curve[2048]).toBe(0);
    expect(curve[4096]).toBeCloseTo(softClip(HEADROOM));
    expect(Math.max(...curve)).toBeLessThanOrEqual(1);
  });
});

describe('options', () => {
  it('mirrors the CLI flags', () => {
    expect(parseOptions('?country=in&search=%20jazz%20&volume=60&gain=6')).toEqual({
      country: 'IN',
      search: 'jazz',
      volume: 60,
      gainDb: 6,
    });
  });

  it('ignores invalid values and clamps ranges', () => {
    expect(parseOptions('?country=IND&volume=abc&gain=')).toEqual({});
    expect(parseOptions('?volume=250&gain=40')).toEqual({ volume: 100, gainDb: 12 });
  });

  it('falls back to defaults for unreadable settings', () => {
    expect(readSettings(null)).toEqual({ volume: 70, gainDb: 0 });
    expect(readSettings('not json')).toEqual({ volume: 70, gainDb: 0 });
    expect(readSettings('{"volume": 35, "gainDb": 99}')).toEqual({ volume: 35, gainDb: 12 });
  });
});

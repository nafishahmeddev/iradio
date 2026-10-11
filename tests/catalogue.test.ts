import { describe, expect, it } from 'vitest';

import { buildShards, matchStations, shardFor } from '../src/lib/catalogue';
import { GENRES, WORLD } from '../src/lib/world';

const record = (
  code: string,
  name: string,
  genres: string[],
  streams: Array<{ url: string; reliability?: number; bitrate?: number }>,
) => ({ id: `${code}-${name}`, name, country: 'ignored', genres, streams, source: `streams/${code}/${code}.m3u` });

const published = {
  stations: [
    record('fr', 'Fip', ['Jazz', 'eclectic', ''], [
      { url: 'http://fip.example/low', reliability: 0.9, bitrate: 64 },
      { url: 'https://fip.example/high', reliability: 0.9, bitrate: 192 },
    ]),
    record('fr', 'Radio Nova', ['Soul'], [{ url: 'http://nova.example/live', reliability: 0.5 }]),
    record('br', 'Rádio Clássica FM', ['classical'], [{ url: 'https://classica.example/live', reliability: 0.95 }]),
    record('jp', 'ラジオ日本', ['news'], [{ url: 'https://nippon.example/live', reliability: 0.9 }]),
    record('jp', 'Playlist Only', ['pop'], [{ url: 'https://jp.example/live.m3u8' }]),
    record('de', 'No Stream', ['pop'], []),
  ],
};

describe('public radio catalogue shards', () => {
  const shards = buildShards(published);
  /** What the Worker does: read the one shard a search points at, then match within it. */
  const search = (query: Parameters<typeof shardFor>[0], secure = false) => {
    const path = shardFor(query);
    return matchStations((path && shards.get(path)) || [], query, secure).map((station) => station.name);
  };

  it('keeps playable stations and picks each one\'s best stream', () => {
    expect(shards.get('country/FR')!.map((station) => station.name)).toEqual(['Fip', 'Radio Nova']);
    expect(shards.get('country/FR')![0]).toMatchObject({
      url: 'https://fip.example/high',
      countrycode: 'FR',
      country: 'France',
      bitrate: 192,
      tags: 'jazz, eclectic',
    });
    expect(shards.has('country/DE')).toBe(false);
  });

  it('finds stations by country, genre and name, ignoring case and accents', () => {
    expect(search({ countrycode: 'fr' })).toEqual(['Fip', 'Radio Nova']);
    expect(search({ countrycode: 'FR' }, true)).toEqual(['Fip']);
    expect(search({ tag: 'JAZZ' })).toEqual(['Fip']);
    expect(search({ name: 'classica' })).toEqual(['Rádio Clássica FM']);
    expect(search({ name: 'ラジオ' })).toEqual(['ラジオ日本']);
    expect(search({ name: 'nothing' })).toEqual([]);
  });

  it('files names under their distinctive words, so common ones do not swamp a shard', () => {
    // "Radio Nova" is found through "nova"; a search that leads with "radio" still reaches it.
    expect(shardFor({ name: 'radio nova' })).toBe(shardFor({ name: 'nova' }));
    expect(search({ name: 'Radio Nova' })).toEqual(['Radio Nova']);
    expect(shards.get(shardFor({ name: 'radio' })!) ?? []).toEqual([]);
  });

  it('cannot match a search with nothing to look up', () => {
    expect(shardFor({ name: '?' })).toBeNull();
    expect(shardFor({ tag: '-' })).toBeNull();
  });

  it('tours the world one country at a time when simply browsing', () => {
    expect(shardFor({})).toBe('tour');
    expect(shards.get('tour')!.map((station) => station.countrycode)).toEqual(['FR', 'BR', 'JP', 'FR']);
  });

  it('uses only file-safe shard names', () => {
    for (const path of shards.keys()) expect(path).toMatch(/^[a-z]+(\/[A-Za-z0-9]+)?$/);
  });

  it('rejects a file in an unknown format', () => {
    expect(() => buildShards({ nope: true })).toThrow();
  });
});

describe('world', () => {
  it('lists each country once, with a real name', () => {
    const countries = WORLD.flatMap((region) => region.countries);
    const codes = countries.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThan(230);
    expect(countries.filter((country) => country.name === country.code)).toEqual([]);
    expect(countries.find((country) => country.code === 'BD')?.name).toBe('Bangladesh');
  });

  it('offers each genre once', () => {
    expect(new Set(GENRES).size).toBe(GENRES.length);
  });
});

/**
 * The second station catalogue: the International Public Radio Directory, a
 * curated and openly licensed world list (https://github.com/iprd-org/iprd).
 *
 * It is one 18 MB file, too large to search on every request, so the build
 * splits it into small shards (per country, per name prefix, per genre prefix,
 * and a world tour). Answering a search then means reading one shard.
 */

import { PAGE_SIZE } from './config';
import { toStation, type Station, type StationQuery } from './stations';
import { countryName } from './world';

export const SOURCE = 'https://iprd-org.github.io/iprd/site_data/metadata/catalog.json';

/** How many stations the world tour keeps: twenty pages. */
const TOUR_LIMIT = 20 * PAGE_SIZE;
const PLAYLIST = /\.(m3u8?|pls|asx|xspf)(\?|$)/i;
/** Words too common in station names to be worth a shard of their own. */
const COMMON = new Set(['radio', 'fm', 'am', 'the', 'la', 'le', 'el', 'de', 'di', 'du', 'of', 'and']);

export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);

/** A file-safe key from a word's first two characters. */
function keyOf(word: string): string {
  return Array.from(word)
    .slice(0, 2)
    .map((char) => (/[a-z0-9]/.test(char) ? char : `u${char.codePointAt(0)!.toString(16)}`))
    .join('');
}

/** The words a name is filed under: its distinctive ones, or all of them if it has none. */
function filing(name: string): string[] {
  const all = words(name);
  const distinctive = all.filter((word) => !COMMON.has(word));
  return distinctive.length ? distinctive : all;
}

/** Which shard answers a search, or null when the search cannot match anything. */
export function shardFor(query: StationQuery): string | null {
  if (query.countrycode) return `country/${query.countrycode.toUpperCase()}`;
  if (query.name) {
    const [word] = filing(query.name);
    return word ? `name/${keyOf(word)}` : null;
  }
  if (query.tag) {
    const [word] = words(query.tag);
    return word ? `tag/${keyOf(word)}` : null;
  }
  return 'tour';
}

/** The stations in a shard that match the search, best first. */
export function matchStations(shard: Station[], query: StationQuery, secureOnly = false): Station[] {
  const name = query.name ? fold(query.name) : '';
  const tag = query.tag ? fold(query.tag) : '';
  const country = query.countrycode?.toUpperCase();
  const matches = shard.filter(
    (station) =>
      (!country || station.countrycode === country) &&
      (!name || fold(station.name).includes(name)) &&
      (!tag || station.tags.includes(tag)) &&
      (!secureOnly || station.url.startsWith('https:')),
  );
  // A name search lists the stations that start with what was typed first.
  if (name) {
    const leads = (station: Station) => Number(fold(station.name).startsWith(name));
    matches.sort((a, b) => leads(b) - leads(a));
  }
  return matches;
}

// ------------------------------------------------------------------ building

/** A fixed pseudo-random fraction per station, so equally ranked stations mix instead of sorting by name. */
function scatter(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) / 2 ** 32;
}

interface RawStream {
  url?: unknown;
  bitrate?: unknown;
  reliability?: unknown;
}

function bestStream(streams: unknown): RawStream | undefined {
  if (!Array.isArray(streams)) return undefined;
  const score = (stream: RawStream) =>
    (String(stream.url).startsWith('https:') ? 4 : 0) +
    2 * (Number(stream.reliability) || 0) +
    Math.min(Number(stream.bitrate) || 0, 320) / 320;
  return (streams as RawStream[])
    .filter((stream) => typeof stream.url === 'string' && !PLAYLIST.test(stream.url))
    .sort((a, b) => score(b) - score(a))[0];
}

/** Turn the published file into shards: path → stations, each list best first. */
export function buildShards(published: unknown): Map<string, Station[]> {
  const records = (published as { stations?: unknown } | null)?.stations;
  if (!Array.isArray(records)) throw new TypeError('Unexpected catalogue format');

  const ranked: Array<{ station: Station; rank: number }> = [];
  for (const record of records as Array<Record<string, unknown>>) {
    const stream = bestStream(record['streams']);
    // Stations are filed by country: streams/<code>/<list>.m3u
    const code = /^streams\/([a-z]{2})\//i.exec(String(record['source']))?.[1]?.toUpperCase() ?? '';
    const genres = [
      ...new Set((Array.isArray(record['genres']) ? record['genres'] : []).map((genre) => fold(String(genre)))),
    ].filter(Boolean);
    const station = toStation({
      stationuuid: record['id'],
      name: record['name'],
      url: stream?.url,
      country: code ? countryName(code) : record['country'],
      countrycode: code,
      bitrate: stream?.bitrate,
      tags: genres.join(','),
      logo: record['logo'],
    });
    if (!station) continue;
    ranked.push({
      station,
      // Verified streams first, then the stations the directory documents best.
      rank:
        4 * (Number(stream?.reliability) || 0) +
        (station.url.startsWith('https:') ? 1 : 0) +
        (station.logo ? 1 : 0) +
        (record['website'] ? 0.5 : 0) +
        (station.bitrate >= 128 ? 0.5 : 0) +
        0.4 * scatter(String(record['id'])),
    });
  }
  ranked.sort((a, b) => b.rank - a.rank);

  const shards = new Map<string, Station[]>();
  const file = (path: string, station: Station) => {
    const list = shards.get(path);
    if (list) list.push(station);
    else shards.set(path, [station]);
  };
  for (const { station } of ranked) {
    if (station.countrycode) file(`country/${station.countrycode}`, station);
    for (const key of new Set(filing(station.name).map(keyOf))) file(`name/${key}`, station);
    for (const key of new Set(words(station.tags).map(keyOf))) file(`tag/${key}`, station);
  }

  // The world tour: the best station of each country in turn, largest countries first.
  const countries = [...shards.entries()]
    .filter(([path]) => path.startsWith('country/'))
    .map(([, list]) => list)
    .sort((a, b) => b.length - a.length);
  const tour: Station[] = [];
  for (let round = 0; tour.length < Math.min(TOUR_LIMIT, ranked.length); round++) {
    const before = tour.length;
    for (const list of countries) {
      const station = list[round];
      if (station && tour.length < TOUR_LIMIT) tour.push(station);
    }
    if (tour.length === before) break;
  }
  shards.set('tour', tour);
  return shards;
}

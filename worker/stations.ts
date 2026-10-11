/** One station search over two catalogues. */

import { matchStations, shardFor } from '../src/lib/catalogue';
import { PAGE_SIZE } from '../src/lib/config';
import type { Station, StationQuery } from '../src/lib/stations';
import { searchRadioBrowser } from './radio-browser';

export type Source = 'radio-browser' | 'iprd';
export const SOURCES: readonly Source[] = ['radio-browser', 'iprd'];

/** The Worker's static files, where the build put the catalogue shards. */
export interface Assets {
  fetch: (input: Request | URL | string) => Promise<Response>;
}

export interface Provider {
  source: Source;
  search: (query: StationQuery, offset: number, secureOnly: boolean) => Promise<Station[]>;
}

/** Search the public radio directory by reading the one shard that can hold the answer. */
export async function searchCatalogue(
  assets: Assets,
  query: StationQuery,
  offset: number,
  secureOnly: boolean,
): Promise<Station[]> {
  const shard = shardFor(query);
  if (!shard) return [];
  const response = await assets.fetch(new URL(`/catalogue/${shard}.json`, 'https://assets.local'));
  // No shard means no station is filed under that country, name or genre.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`The public radio catalogue answered with status ${response.status}`);
  const stations = (await response.json()) as Station[];
  return matchStations(stations, query, secureOnly).slice(offset, offset + PAGE_SIZE);
}

/**
 * Radio Browser first: it is the larger catalogue and ranks by listener votes.
 * The public radio directory second: curated, and served from this site's own files.
 */
export const providers = (assets: Assets): Provider[] => [
  { source: 'radio-browser', search: (query, offset, secureOnly) => searchRadioBrowser(query, offset, secureOnly) },
  { source: 'iprd', search: (query, offset, secureOnly) => searchCatalogue(assets, query, offset, secureOnly) },
];

export interface Found {
  stations: Station[];
  source: Source;
}

/**
 * A page of stations from the first catalogue that answers. Later pages stay
 * with the catalogue the first page came from, since offsets are not comparable.
 */
export async function findStations(
  from: Provider[],
  query: StationQuery,
  offset: number,
  secureOnly: boolean,
  only?: Source,
): Promise<Found> {
  const failures: string[] = [];
  for (const provider of from) {
    if (only && provider.source !== only) continue;
    try {
      return { stations: await provider.search(query, offset, secureOnly), source: provider.source };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(failures.join('; ') || 'No station catalogue is available');
}

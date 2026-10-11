/** Client side of the station search endpoint. */

import { toStations, type Station, type StationQuery } from '../lib/stations';

export interface Found {
  stations: Station[];
  /** Which catalogue answered; later pages of the same list must ask the same one. */
  source: string;
}

export async function fetchStations(
  query: StationQuery,
  offset: number,
  source: string | null,
  signal: AbortSignal,
): Promise<Found> {
  const params = new URLSearchParams({ ...query, offset: String(offset) });
  if (source && offset > 0) params.set('source', source);
  // A secure page cannot load http:// audio; leave those stations out rather than list what cannot play.
  if (window.location.protocol === 'https:') params.set('secure', '1');
  let response: Response;
  try {
    response = await fetch(`/api/stations?${params}`, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Could not reach iRadio. Check your connection.');
  }
  const body: unknown = await response.json().catch(() => null);
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof record['error'] === 'string' ? record['error'] : 'Station search failed');
  }
  return { stations: toStations(record['stations']), source: String(record['source'] ?? '') };
}

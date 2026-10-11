/** The station shape shared by the directory endpoint, the UI and favorites. */

export interface Station {
  stationuuid?: string;
  name: string;
  url: string;
  country: string;
  countrycode: string;
  bitrate: number;
  tags: string;
  /** Station artwork; only https, so it can load on a secure page. */
  logo?: string;
}

export type StationQuery = Partial<Record<'name' | 'tag' | 'countrycode', string>>;

export function stationId(station: Pick<Station, 'stationuuid' | 'url'>): string {
  return station.stationuuid || station.url;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  // Directory entries are user-submitted; drop control characters.
  return Array.from(value.slice(0, limit * 2), (char) => (/\p{Cc}/u.test(char) ? ' ' : char))
    .join('')
    .trim()
    .slice(0, limit);
}

export function isStreamUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate one untrusted record (directory row or stored favorite). */
export function toStation(raw: unknown): Station | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const url = [record['url_resolved'], record['url']].find(isStreamUrl);
  if (!url) return null;
  const bitrate = Number(record['bitrate']);
  const station: Station = {
    name: text(record['name'], 200) || 'Untitled',
    url,
    country: text(record['country'], 80),
    countrycode: text(record['countrycode'], 2).toUpperCase(),
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate) : 0,
    tags: text(record['tags'], 200).replaceAll(',', ', ').replace(/\s+/g, ' '),
  };
  const uuid = text(record['stationuuid'], 64);
  if (uuid) station.stationuuid = uuid;
  // Radio Browser calls it favicon; the public radio directory calls it logo.
  const logo = [record['logo'], record['favicon']].find(
    (value): value is string => isStreamUrl(value) && value.startsWith('https:') && value.length <= 500,
  );
  if (logo) station.logo = logo;
  return station;
}

export function toStations(raw: unknown): Station[] {
  if (!Array.isArray(raw)) throw new TypeError('Expected a list of stations');
  return raw.map(toStation).filter((station): station is Station => station !== null);
}

export function isCountryCode(value: string): boolean {
  return /^[A-Za-z]{2}$/.test(value);
}

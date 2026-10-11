/** Radio Browser transport, with mirror discovery and failover. */

import { PAGE_SIZE } from '../src/lib/config';
import { toStations, type Station, type StationQuery } from '../src/lib/stations';

const FALLBACK_SERVERS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info'];
const DISCOVERY_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 6_000;

let discovered: { at: number; hosts: string[] } | undefined;

/**
 * The directory publishes its live mirrors as DNS SRV records. A Worker cannot
 * make DNS queries itself, so it asks a DNS-over-HTTPS resolver.
 */
export async function discoverServers(request: typeof fetch = fetch, now = Date.now()): Promise<string[]> {
  if (discovered && now - discovered.at < DISCOVERY_TTL_MS) return discovered.hosts;
  let hosts: string[] = [];
  try {
    const response = await request(
      'https://cloudflare-dns.com/dns-query?name=_api._tcp.radio-browser.info&type=SRV',
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const answer = (await response.json()) as { Answer?: Array<{ data?: unknown }> };
    // An SRV answer reads "priority weight port target."
    hosts = (answer.Answer ?? [])
      .map((record) => String(record.data).trim().split(/\s+/)[3]?.replace(/\.$/, '') ?? '')
      .filter((host) => host.endsWith('.radio-browser.info'));
  } catch {
    // DNS trouble: fall through to the known mirrors.
  }
  hosts = [...new Set([...hosts, ...FALLBACK_SERVERS])];
  discovered = { at: now, hosts };
  return hosts;
}

/** fetch() hides the network reason in `cause`; surface it. */
function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? error.cause.message : error.message;
}

export interface RadioBrowserDeps {
  servers: () => Promise<string[]>;
  fetch: typeof fetch;
}

const defaults: RadioBrowserDeps = { servers: () => discoverServers(), fetch: (...args) => fetch(...args) };

export async function searchRadioBrowser(
  query: StationQuery,
  offset = 0,
  secureOnly = false,
  deps: RadioBrowserDeps = defaults,
): Promise<Station[]> {
  const params = new URLSearchParams({
    ...query,
    codec: 'MP3',
    hidebroken: 'true',
    order: 'votes',
    reverse: 'true',
    limit: String(PAGE_SIZE),
    offset: String(offset),
    // A secure page cannot load http:// audio, so do not list what it cannot play.
    ...(secureOnly ? { is_https: 'true' } : {}),
  });
  let failure = 'no servers';
  for (const host of await deps.servers()) {
    try {
      const response = await deps.fetch(`https://${host}/json/stations/search?${params}`, {
        headers: { 'User-Agent': 'iRadio/0.1' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${host} answered with status ${response.status}`);
      return toStations(await response.json());
    } catch (error) {
      failure = reason(error);
    }
  }
  throw new Error(`Radio Browser is not answering: ${failure}`);
}

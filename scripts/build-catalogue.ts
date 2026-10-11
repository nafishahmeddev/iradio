/**
 * Downloads the International Public Radio Directory and writes it as shards
 * under public/catalogue, where the build publishes them as static files.
 * Run by `npm run build`; the download is reused for a day.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildShards, SOURCE } from '../src/lib/catalogue';

const root = join(import.meta.dirname, '..');
const cache = join(root, 'node_modules', '.cache', 'iradio', 'catalog.json');
const output = join(root, 'public', 'catalogue');
const DAY_MS = 24 * 60 * 60_000;
const ATTEMPTS = 3;

async function download(): Promise<string> {
  const age = await stat(cache).then((file) => Date.now() - file.mtimeMs, () => Infinity);
  if (age < DAY_MS) return readFile(cache, 'utf8');
  let failure: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(SOURCE, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const text = await response.text();
      await mkdir(dirname(cache), { recursive: true });
      await writeFile(cache, text);
      return text;
    } catch (error) {
      failure = error;
      console.warn(`catalogue: download attempt ${attempt} of ${ATTEMPTS} failed: ${error}`);
    }
  }
  // An older copy is better than no second catalogue at all.
  if (Number.isFinite(age)) {
    console.warn('catalogue: using the previous download');
    return readFile(cache, 'utf8');
  }
  throw new Error(`Could not download the station catalogue from ${SOURCE}: ${failure}`);
}

const shards = buildShards(JSON.parse(await download()));
await rm(output, { recursive: true, force: true });
let bytes = 0;
let largest = 0;
for (const [path, stations] of shards) {
  const file = join(output, `${path}.json`);
  const body = JSON.stringify(stations);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  bytes += body.length;
  largest = Math.max(largest, body.length);
}
const megabytes = (value: number) => `${(value / 1e6).toFixed(1)} MB`;
console.log(
  `catalogue: ${shards.size} shards, ${megabytes(bytes)} in all, largest ${megabytes(largest)}, ` +
    `${shards.get('tour')?.length ?? 0} stations on the world tour`,
);

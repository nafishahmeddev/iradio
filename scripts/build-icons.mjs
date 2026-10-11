/**
 * Renders the app icons from the logo. Run by hand when the mark changes
 * (`node scripts/build-icons.mjs`); the PNGs it writes are committed.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

const out = join(import.meta.dirname, '..', 'public', 'icons');
const INK = '#08080a';

const mark = `
  <g fill="none">
    <g stroke="#f5f2ec" stroke-width="2.25" stroke-linecap="round">
      <path d="M30.89 8.21a9 9 0 0 1 0 11.58M17.11 8.21a9 9 0 0 0 0 11.58"/>
      <path d="M34.72 5a14 14 0 0 1 0 18M13.28 5a14 14 0 0 0 0 18" opacity="0.45"/>
    </g>
    <rect x="20" y="24" width="8" height="20" rx="4" fill="#f5f2ec"/>
    <circle cx="24" cy="14" r="4.5" fill="#ffb454"/>
  </g>`;

/** The 48-unit mark centred on a square, filling `share` of its width. */
const icon = (share, radius) => {
  const scale = (64 * share) / 48;
  const offset = (64 - 48 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${radius}" fill="${INK}"/>
    <g transform="translate(${offset} ${offset}) scale(${scale})">${mark}</g>
  </svg>`;
};

await mkdir(out, { recursive: true });
for (const [name, size, svg] of [
  ['icon-192.png', 192, icon(0.75, 14)],
  ['icon-512.png', 512, icon(0.75, 14)],
  // Maskable: the platform crops to its own shape, so the mark stays inside the safe centre.
  ['maskable-512.png', 512, icon(0.56, 0)],
  // iOS rounds the corners itself and shows any transparency as black.
  ['apple-touch-icon.png', 180, icon(0.68, 0)],
]) {
  await sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(join(out, name));
  console.log(`icons: ${name}`);
}

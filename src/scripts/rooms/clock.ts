/**
 * A clock every device in a room agrees on, set from the Worker's time route.
 * Cloudflare's own time endpoint would avoid the Worker, but it only reports
 * whole seconds, which is far too coarse to line music up.
 */

let offset = 0;
let timer = 0;

/**
 * The device's own clock, read in a way that never jumps: a phone correcting
 * its wall clock mid-song must not move the music.
 */
const local = () => performance.timeOrigin + performance.now();

/** The shared time, in milliseconds. */
export const now = () => local() + offset;

async function measure(url: string, read: (text: string) => number): Promise<{ took: number; offset: number }> {
  let best: { took: number; offset: number } | undefined;
  // The first request pays for opening the connection, so it is thrown away.
  for (let i = 0; i < 9; i++) {
    const sent = performance.now();
    const response = await fetch(`${url}?${Math.random()}`, { cache: 'no-store' });
    const server = read(await response.text());
    const took = performance.now() - sent;
    if (!response.ok || !Number.isFinite(server)) throw new Error('No time');
    // The answer was produced about halfway through the round trip.
    if (i > 0 && (!best || took < best.took)) best = { took, offset: server - took / 2 - (performance.timeOrigin + sent) };
  }
  return best!;
}

async function sync(): Promise<void> {
  try {
    offset = (await measure('/api/time', (text) => Number(JSON.parse(text).now))).offset;
  } catch {
    // Keep the last setting, or the device's own clock; most phones are within a fraction of a second.
  }
}

/** Set the clock now and keep it set while a room is open. */
export async function startClock(): Promise<void> {
  window.clearInterval(timer);
  timer = window.setInterval(() => void sync(), 2 * 60_000);
  await sync();
}

export function stopClock(): void {
  window.clearInterval(timer);
}

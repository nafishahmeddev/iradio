/**
 * How a device closes the gap between where its player is and where the
 * room's timeline says it should be. Pure decisions; the device carries them out.
 */

export type Correction =
  | { kind: 'none' }
  /** Jump to this position. */
  | { kind: 'seek'; to: number };

/**
 * A room does not need its devices to be exact, and every correction interrupts
 * the sound. So a player is left alone while it is within `allowed` seconds of
 * the timeline, and jumps only when two readings in a row put it beyond that on
 * the same side: one reading can be wrong when a device is busy.
 *
 * @param previous The reading before this one, in the same terms as `error`.
 * @param error Seconds the player is ahead of the timeline (negative: behind).
 * @param target Where the timeline is now, in seconds.
 * @param lead How long this device's jumps take to land, learned by `learnLead`.
 */
export function correct(previous: number, error: number, target: number, lead: number, allowed: number): Correction {
  const beyond = Math.abs(error) > allowed && Math.abs(previous) > allowed && Math.sign(previous) === Math.sign(error);
  return beyond ? { kind: 'seek', to: target + lead } : { kind: 'none' };
}

/** After a jump lands `residual` seconds ahead of the timeline, adjust how far ahead to aim next time. */
export function learnLead(lead: number, residual: number): number {
  return Math.max(0, Math.min(2, lead - residual * 0.7));
}

/**
 * How loud a song should be at a moment in its life, from 0 to 1: it eases in
 * at the start, out at the end, and is silent before it begins. A station has
 * no end (`seconds` is 0), so it only eases in.
 */
export function envelope(position: number, seconds: number, fadeIn: number, fadeOut: number): number {
  if (position <= 0) return 0;
  const rise = Math.min(1, position / fadeIn);
  if (seconds <= 0) return rise;
  const fall = Math.max(0, Math.min(1, (seconds - position) / fadeOut));
  return Math.min(rise, fall);
}

/** Move a loudness towards its target at a steady pace, however long ago it was last moved. */
export function glide(current: number, target: number, elapsedMs: number, fullScaleMs: number): number {
  const step = elapsedMs / fullScaleMs;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

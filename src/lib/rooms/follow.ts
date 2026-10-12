/**
 * How a device closes the gap between where its player is and where the
 * room's timeline says it should be. Pure decisions; the device carries them out.
 */

/** What a player can do about its speed: any value, YouTube's fixed steps, or nothing. */
export type Rates = 'fine' | 'steps' | 'none';

export type Correction =
  | { kind: 'none' }
  /** Play at this speed for this long, then return to normal. */
  | { kind: 'rate'; rate: number; forMs: number }
  /** Jump to this position. */
  | { kind: 'seek'; to: number };

/** Closer than this is in step; chasing it further would only add wobble. */
export const IN_STEP = 0.04;
/** Beyond this a change of speed would take too long, so the player jumps. */
export const JUMP_BEYOND = 1;
/** A player that cannot change speed can only jump, and a jump is audible, so it tolerates more. */
export const JUMP_BEYOND_FIXED = 0.25;
/**
 * A player with only coarse speeds also reports its position coarsely. It is left
 * alone until it has drifted this far: chasing less is heard as stutter.
 */
export const DRIFT_ALLOWED = 0.3;
/** Just after a jump the gap is closed by speed up to here, so a slow connection does not jump again and again. */
export const REJUMP_BEYOND = 2.5;
const STEP = 0.25;
const FINE_LIMIT = 0.08;

/**
 * @param error Seconds the player is ahead of the timeline (negative: behind).
 * @param target Where the timeline is now, in seconds.
 * @param lead How long this device's jumps take to land, learned by `learnLead`.
 * @param afterJump Whether the player jumped a moment ago.
 */
export function correct(error: number, target: number, rates: Rates, lead: number, afterJump = false): Correction {
  const size = Math.abs(error);
  if (size < IN_STEP) return { kind: 'none' };
  if (rates === 'none') return size > JUMP_BEYOND_FIXED ? { kind: 'seek', to: target + lead } : { kind: 'none' };
  if (size > (afterJump ? REJUMP_BEYOND : JUMP_BEYOND)) return { kind: 'seek', to: target + lead };
  if (rates === 'steps') {
    if (size < DRIFT_ALLOWED) return { kind: 'none' };
    // Ahead: play at three-quarter speed; behind: one and a quarter. Each closes a quarter second per second.
    return { kind: 'rate', rate: error > 0 ? 1 - STEP : 1 + STEP, forMs: Math.round((size / STEP) * 1000) };
  }
  // A gentle speed change, too small to hear, re-judged every second.
  const change = Math.max(-FINE_LIMIT, Math.min(FINE_LIMIT, error * 0.6));
  return { kind: 'rate', rate: 1 - change, forMs: 1000 };
}

/**
 * One reading of the position can be wrong: players report late when a device is busy.
 * A gap is acted on only when the reading before it showed the same gap, on the same side.
 */
export function confirmed(previous: number, error: number): boolean {
  return Math.abs(previous) >= IN_STEP && Math.sign(previous) === Math.sign(error);
}

/** After a jump lands `residual` seconds ahead of the timeline, adjust how far ahead to aim next time. */
export function learnLead(lead: number, residual: number): number {
  return Math.max(0, Math.min(2, lead - residual * 0.7));
}

/** A position report older than this cannot be trusted to say where the player is now. */
export const STALE_MS = 600;

/**
 * A player that reports its position only now and then: the true position is
 * the last report plus the time since, while it is playing.
 */
export function between(reported: number, reportedAtMs: number, nowMs: number, rate: number, playing: boolean): number {
  if (!playing) return reported;
  // A report older than this means the player has stalled; do not run on ahead of it.
  return reported + (Math.min(nowMs - reportedAtMs, STALE_MS) / 1000) * rate;
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

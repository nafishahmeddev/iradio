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
const STEP = 0.25;
const FINE_LIMIT = 0.08;

/**
 * @param error Seconds the player is ahead of the timeline (negative: behind).
 * @param target Where the timeline is now, in seconds.
 * @param lead How long this device's jumps take to land, learned by `learnLead`.
 */
export function correct(error: number, target: number, rates: Rates, lead: number): Correction {
  const size = Math.abs(error);
  if (size < IN_STEP) return { kind: 'none' };
  if (rates === 'none') return size > JUMP_BEYOND_FIXED ? { kind: 'seek', to: target + lead } : { kind: 'none' };
  if (size > JUMP_BEYOND) return { kind: 'seek', to: target + lead };
  if (rates === 'steps') {
    // Ahead: play at three-quarter speed; behind: one and a quarter. Each closes a quarter second per second.
    return { kind: 'rate', rate: error > 0 ? 1 - STEP : 1 + STEP, forMs: Math.round((size / STEP) * 1000) };
  }
  // A gentle speed change, too small to hear, re-judged every second.
  const change = Math.max(-FINE_LIMIT, Math.min(FINE_LIMIT, error * 0.6));
  return { kind: 'rate', rate: 1 - change, forMs: 1000 };
}

/** After a jump lands `residual` seconds ahead of the timeline, adjust how far ahead to aim next time. */
export function learnLead(lead: number, residual: number): number {
  return Math.max(0, Math.min(2, lead - residual * 0.7));
}

/**
 * A player that reports its position only now and then: the true position is
 * the last report plus the time since, while it is playing.
 */
export function between(reported: number, reportedAtMs: number, nowMs: number, rate: number, playing: boolean): number {
  if (!playing) return reported;
  // A report older than this means the player has stalled; do not run on ahead of it.
  return reported + (Math.min(nowMs - reportedAtMs, 600) / 1000) * rate;
}

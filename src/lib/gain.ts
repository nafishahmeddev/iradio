/** Preamp maths: decibels to amplitude, and the soft clipper that follows it. */

import { MAX_GAIN_DB } from './config';

export function dbToAmplitude(db: number): number {
  return 10 ** (db / 20);
}

/** Largest amplitude the preamp can produce from a full-scale signal. */
export const HEADROOM = dbToAmplitude(MAX_GAIN_DB);

const KNEE = 0.7;

/** Linear below the knee, then eases towards full scale instead of clipping hard. */
export function softClip(value: number): number {
  const size = Math.abs(value);
  if (size <= KNEE) return value;
  const room = 1 - KNEE;
  return Math.sign(value) * (KNEE + room * Math.tanh((size - KNEE) / room));
}

/**
 * Transfer curve for a WaveShaperNode. The node only maps inputs in [-1, 1],
 * so the curve spans [-HEADROOM, HEADROOM] and the signal is scaled to fit.
 */
export function softClipCurve(points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    curve[i] = softClip(((i / (points - 1)) * 2 - 1) * HEADROOM);
  }
  return curve;
}

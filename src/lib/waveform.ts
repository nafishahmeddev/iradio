/** Display maths for the oscilloscope. None of this changes what is heard. */

const SILENCE = 0.0005;
const MAX_DISPLAY_GAIN = 8;
/** Fraction of the remembered peak that survives one second without a louder one. */
const PEAK_RELEASE_PER_SECOND = 0.544;

export function peakOf(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i] ?? 0);
    if (value > peak) peak = value;
  }
  return peak;
}

export function isSilent(samples: ArrayLike<number>): boolean {
  return peakOf(samples) < SILENCE;
}

/** Remembered peak: jumps up at once, recovers gradually after loud passages. */
export function trackPeak(remembered: number, peak: number, seconds: number): number {
  return Math.max(peak, remembered * PEAK_RELEASE_PER_SECOND ** Math.max(0, seconds), 0.01);
}

/** Automatic gain (1× to 8×) that makes quiet audio visible. */
export function displayGain(rememberedPeak: number): number {
  return Math.min(MAX_DISPLAY_GAIN, Math.max(1, 0.85 / rememberedPeak));
}

/**
 * First rising zero crossing that leaves `span` samples after it, so
 * successive frames line up like a triggered oscilloscope sweep.
 */
export function triggerIndex(samples: ArrayLike<number>, span: number): number {
  const last = samples.length - span;
  for (let i = 1; i <= last; i++) {
    if ((samples[i - 1] ?? 0) < 0 && (samples[i] ?? 0) >= 0) return i;
  }
  return 0;
}

/**
 * Fold an FFT magnitude spectrum (bytes, linear in frequency) into `out.length`
 * bands spaced by pitch, each 0 to 1, so bass and treble get equal room.
 */
export function pitchBands(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  out: Float32Array,
  lowHz = 40,
  highHz = 14_000,
): Float32Array {
  const hzPerBin = sampleRate / 2 / spectrum.length;
  const ratio = highHz / lowHz;
  for (let band = 0; band < out.length; band++) {
    const from = Math.floor((lowHz * ratio ** (band / out.length)) / hzPerBin);
    const to = Math.max(from + 1, Math.ceil((lowHz * ratio ** ((band + 1) / out.length)) / hzPerBin));
    let peak = 0;
    for (let bin = from; bin < to && bin < spectrum.length; bin++) {
      peak = Math.max(peak, spectrum[bin] ?? 0);
    }
    out[band] = peak / 255;
  }
  return out;
}

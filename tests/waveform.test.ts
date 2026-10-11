import { describe, expect, it } from 'vitest';

import {
  displayGain,
  isSilent,
  peakOf,
  pitchBands,
  trackPeak,
  triggerIndex,
} from '../src/lib/waveform';

describe('waveform display', () => {
  it('measures the signed peak', () => {
    expect(peakOf([0.1, -0.6, 0.3])).toBeCloseTo(0.6);
    expect(peakOf([])).toBe(0);
  });

  it('treats near-zero audio as a flat line', () => {
    expect(isSilent([0, 0.0001, -0.0002])).toBe(true);
    expect(isSilent([0, 0.01])).toBe(false);
  });

  it('boosts quiet audio up to 8× and never reduces loud audio', () => {
    expect(displayGain(0.01)).toBe(8);
    expect(displayGain(0.425)).toBeCloseTo(2);
    expect(displayGain(1)).toBe(1);
  });

  it('follows loud peaks at once and recovers gradually', () => {
    expect(trackPeak(0.1, 0.8, 0.016)).toBe(0.8);
    const later = trackPeak(0.8, 0.05, 1);
    expect(later).toBeLessThan(0.8);
    expect(later).toBeGreaterThan(0.05);
    expect(trackPeak(0.02, 0, 60)).toBe(0.01);
  });

  it('triggers on the first rising zero crossing that leaves a full sweep', () => {
    const samples = [0.5, 0.2, -0.3, -0.1, 0.4, 0.6, -0.2, 0.3, 0.1, 0];
    expect(triggerIndex(samples, 4)).toBe(4);
    expect(triggerIndex(samples, 6)).toBe(4);
    expect(triggerIndex(samples, 8)).toBe(0);
    expect(triggerIndex(new Float32Array(16), 8)).toBe(0);
  });
});

describe('spectrum bands', () => {
  it('spaces bands by pitch and scales them to 0..1', () => {
    // 1024 bins over 0..24 kHz: a tone near 100 Hz lands in bin 4, one near 10 kHz in bin 427.
    const spectrum = new Uint8Array(1024);
    spectrum[4] = 255;
    spectrum[427] = 128;
    const bands = pitchBands(spectrum, 48_000, new Float32Array(8));
    expect(bands[1]).toBe(1);
    expect(bands[7]).toBeCloseTo(128 / 255);
    expect(bands[4]).toBe(0);
  });

  it('never reads past the spectrum', () => {
    const bands = pitchBands(new Uint8Array(16).fill(255), 8_000, new Float32Array(4));
    expect([...bands].every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});

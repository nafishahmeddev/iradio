/** Plays a station straight from its broadcaster and exposes its audio for drawing. */

import { MAX_GAIN_DB } from '../lib/config';
import { clamp } from '../lib/format';
import { dbToAmplitude, HEADROOM, softClipCurve } from '../lib/gain';
import type { Station } from '../lib/stations';

export type PlayerState = 'idle' | 'connecting' | 'playing' | 'paused' | 'stopped' | 'error';

/**
 * How a station is reached, tried in this order:
 * - open: direct, with the broadcaster's permission to read the audio (CORS),
 *   so it runs through the audio graph: waveform, spectrum and boost all work.
 * - plain: direct, without that permission. It plays, but the browser keeps the
 *   samples private, so there is nothing to draw and nothing to boost.
 */
type Route = 'open' | 'plain';

export interface Reading {
  wave: Float32Array;
  spectrum: Uint8Array;
  sampleRate: number;
}

/** A pause longer than this rejoins the live broadcast instead of a stale buffer. */
const REJOIN_AFTER_MS = 15_000;
/** A route that has neither played nor failed by now is given up on. */
const ATTEMPT_TIMEOUT_MS = 12_000;
const RAMP_SECONDS = 0.015;

interface Graph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  preamp: GainNode;
  clipper: WaveShaperNode;
  master: GainNode;
}

export class Player {
  current: Station | null = null;
  state: PlayerState = 'idle';

  /** Wired into the audio graph; only ever given audio the page may read. */
  private readonly readable = new Audio();
  /** Plays on its own, for stations whose audio the page may not read. */
  private readonly opaque = new Audio();
  private active = this.readable;
  private routes: Route[] = [];
  private timer = 0;
  private graph: Graph | undefined;
  private readonly samples = new Float32Array(2048);
  private readonly spectrum = new Uint8Array(1024);
  private elapsedBefore = 0;
  private pausedAt = 0;

  constructor(
    public volume: number,
    public gainDb: number,
    private readonly onChange: () => void,
  ) {
    this.readable.crossOrigin = 'anonymous';
    for (const audio of [this.readable, this.opaque]) {
      audio.preload = 'none';
      const on = (type: string, handler: () => void) =>
        audio.addEventListener(type, () => this.current && audio === this.active && handler());
      on('playing', () => {
        window.clearTimeout(this.timer);
        this.set('playing');
      });
      on('waiting', () => this.state === 'playing' && this.set('connecting'));
      on('ended', () => this.set('stopped'));
      on('error', () => this.advance());
    }
    this.opaque.volume = volume / 100;
  }

  get paused(): boolean {
    return this.state === 'paused';
  }

  /** True while the audio can be read: the scene shows the real signal and boost applies. */
  get readableAudio(): boolean {
    return this.active === this.readable;
  }

  /** Seconds of audio decoded for the current station. */
  get elapsed(): number {
    return this.current ? this.elapsedBefore + this.active.currentTime : 0;
  }

  play(station: Station): void {
    this.current = station;
    this.elapsedBefore = 0;
    this.connect();
  }

  pause(): void {
    if (!this.current) return;
    if (this.state === 'paused') {
      if (performance.now() - this.pausedAt > REJOIN_AFTER_MS) {
        this.elapsedBefore += this.active.currentTime;
        this.connect();
      } else {
        this.set('connecting');
        this.start();
      }
    } else if (this.state === 'playing' || this.state === 'connecting') {
      window.clearTimeout(this.timer);
      this.active.pause();
      this.pausedAt = performance.now();
      this.set('paused');
    }
  }

  stop(): void {
    this.current = null;
    this.elapsedBefore = 0;
    this.silence();
    this.set('idle');
  }

  setVolume(volume: number): void {
    this.volume = clamp(Math.round(volume), 0, 100);
    this.opaque.volume = this.volume / 100;
    this.graph?.master.gain.setTargetAtTime(
      this.volume / 100,
      this.graph.context.currentTime,
      RAMP_SECONDS,
    );
  }

  setGain(gainDb: number): void {
    this.gainDb = clamp(gainDb, 0, MAX_GAIN_DB);
    if (this.graph) this.wire(this.graph);
  }

  /**
   * Samples and spectrum of what is playing now; 'unreadable' when it plays
   * but the broadcaster keeps its samples private; null when nothing plays.
   */
  read(): Reading | 'unreadable' | null {
    if (this.state !== 'playing') return null;
    if (!this.graph || !this.readableAudio) return 'unreadable';
    const { analyser, context } = this.graph;
    analyser.getFloatTimeDomainData(this.samples);
    analyser.getByteFrequencyData(this.spectrum);
    return { wave: this.samples, spectrum: this.spectrum, sampleRate: context.sampleRate };
  }

  private set(state: PlayerState): void {
    if (state === this.state && state !== 'idle') return;
    this.state = state;
    this.onChange();
  }

  private connect(): void {
    const station = this.current;
    if (!station) return;
    // A secure page may not load http:// audio at all, so there is nothing to try.
    const insecure = window.location.protocol === 'https:' && station.url.startsWith('http:');
    this.routes = insecure ? [] : ['open', 'plain'];
    this.set('connecting');
    this.advance();
  }

  /** Try the next route, or report that the station cannot be reached. */
  private advance(): void {
    window.clearTimeout(this.timer);
    this.silence();
    const station = this.current;
    const route = this.routes.shift();
    if (!station || !route) {
      this.set('error');
      return;
    }
    this.active = route === 'plain' ? this.opaque : this.readable;
    if (this.active === this.readable) void this.ensureGraph().context.resume();
    this.active.src = station.url;
    this.timer = window.setTimeout(() => this.advance(), ATTEMPT_TIMEOUT_MS);
    this.onChange();
    this.start();
  }

  private start(): void {
    const station = this.current;
    const audio = this.active;
    audio.play().catch((error: unknown) => {
      // Superseded by a newer play, stop or route; the element's error event handles real failures.
      if (this.current !== station || audio !== this.active) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') this.set('error');
    });
  }

  private silence(): void {
    for (const audio of [this.readable, this.opaque]) {
      if (!audio.hasAttribute('src')) continue;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    window.clearTimeout(this.timer);
  }

  /** Created on the first play, because browsers only start audio from a user action. */
  private ensureGraph(): Graph {
    if (this.graph) return this.graph;
    const context = new AudioContext({ latencyHint: 'playback' });
    const graph: Graph = {
      context,
      source: context.createMediaElementSource(this.readable),
      analyser: new AnalyserNode(context, { fftSize: this.samples.length }),
      preamp: context.createGain(),
      clipper: new WaveShaperNode(context, { curve: softClipCurve(), oversample: '2x' }),
      master: new GainNode(context, { gain: this.volume / 100 }),
    };
    // The scene reads the decoded signal, before boost and volume.
    graph.source.connect(graph.analyser);
    graph.preamp.connect(graph.clipper).connect(graph.master);
    graph.master.connect(context.destination);
    this.wire(graph);
    this.graph = graph;
    return graph;
  }

  /** At 0 dB the signal bypasses the preamp entirely, so it is untouched. */
  private wire({ source, preamp, master }: Graph): void {
    for (const node of [preamp, master]) {
      try {
        source.disconnect(node);
      } catch {
        // Not connected.
      }
    }
    if (this.gainDb > 0) {
      preamp.gain.value = dbToAmplitude(this.gainDb) / HEADROOM;
      source.connect(preamp);
    } else {
      source.connect(master);
    }
  }
}

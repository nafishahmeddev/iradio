/**
 * The full-screen WebGL2 scene. Around the dial, a field of ripples: each ring
 * is the stream's real waveform from a moment ago, travelling outward and bent
 * by flowing noise. Behind it, slow coloured light; over everything, film grain.
 */

import { displayGain, isSilent, peakOf, pitchBands, trackPeak, triggerIndex } from '../lib/waveform';

/** Samples taken from the audio for one ring, before it is smoothed down. */
const SPAN = 512;
/** Points around half the dial; the other half mirrors them. */
const POINTS = 96;
const RINGS = 22;
/** Seconds between one ring leaving the dial and the next. */
const CADENCE = 0.075;
/** The innermost ring's radius as a share of half the dial element. */
const RING = 0.5;

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uHistory;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uPhase;
uniform vec3 uInk;
uniform vec3 uAmber;
uniform vec3 uEmber;
uniform vec3 uCool;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uLive;
uniform float uMotion;
out vec4 outColor;

const float PI = 3.14159265;
const float RINGS = ${RINGS}.0;
/** How far the ripples reach, in dial radii. */
const float SPREAD = 2.3;

/** An integer hash: even, pattern-free noise, unlike the usual sine trick. */
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float weight = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += weight * noise(p);
    p = p * 2.03 + 17.0;
    weight *= 0.5;
  }
  return sum;
}

/** A soft, round field of one colour. */
float light(vec2 q, vec2 at, float size) {
  vec2 d = q - at;
  return exp(-dot(d, d) / (size * size));
}

/** Amber where a ripple is born, coral as it travels, violet as it fades. */
vec3 hue(float age) {
  return age < 0.45 ? mix(uAmber, uEmber, age / 0.45) : mix(uEmber, uCool, (age - 0.45) / 0.55);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = gl_FragCoord.xy - uCenter;
  float radius = uRadius * (1.0 + 0.05 * uBass);
  float r = length(p) / radius;
  // 0 at twelve o'clock to 1 at six, mirrored left and right so a ring has no seam.
  float t = abs(atan(p.x, p.y)) / PI;
  vec2 around = vec2(sin(t * PI), cos(t * PI));

  // Backdrop: three slow lights, torn at the edges by flowing noise.
  vec2 q = p / min(uResolution.y, uResolution.x * 0.8);
  vec2 flow = vec2(fbm(q * 2.2 + uTime * 0.05), fbm(q * 2.2 + 31.0 - uTime * 0.04)) - 0.5;
  q += 0.16 * flow;
  float swell = 1.0 + 0.6 * uLevel;
  vec3 color = uInk;
  color += uEmber * 0.26 * swell * light(q, vec2(-0.24 + 0.1 * sin(uTime * 0.11), 0.18 + 0.08 * cos(uTime * 0.09)), 0.4);
  color += uCool * 0.3 * swell * light(q, vec2(0.3 + 0.09 * cos(uTime * 0.08), -0.24 + 0.1 * sin(uTime * 0.12)), 0.48);
  color += uAmber * (0.08 + 0.34 * uBass) * light(q, vec2(0.0), 0.26);
  // The dial face stays dark so the artwork reads clearly.
  color = mix(color, uInk, smoothstep(1.02, 0.9, r) * 0.9);

  // Ripples. Ring k left the dial k steps ago and carries the waveform from then.
  float gap = SPREAD / RINGS;
  float position = (r - 1.0) / gap - uPhase;
  float pixel = 1.0 / radius;
  vec3 ripples = vec3(0.0);
  for (int j = -3; j <= 3; j++) {
    float k = floor(position) + float(j);
    if (k < 0.0 || k >= RINGS) continue;
    float age = (k + uPhase) / RINGS;
    float sample_ = texture(uHistory, vec2((t * (float(${POINTS}) - 1.0) + 0.5) / float(${POINTS}), (k + 0.5) / RINGS)).r * 2.0 - 1.0;
    // Flowing noise bends every ring a little, more as it travels, so the field is alive even in silence.
    float bend = (noise(around * 1.8 + vec2(k * 0.17, uTime * 0.16)) - 0.5) * gap * (0.4 + 2.4 * age);
    float ring = 1.0 + (k + uPhase) * gap + sample_ * gap * 1.5 * (1.0 - 0.35 * age) + bend;
    float away = abs(r - ring) / pixel;
    float width = mix(1.25, 0.85, age) * max(1.0, radius / 150.0);
    float fade = smoothstep(0.0, 0.05, age) * pow(1.0 - age, 1.25);
    // A hairline with a wide, faint bloom around it.
    float line = smoothstep(width, 0.0, away) + 0.16 * exp(-away * away / (width * width * 90.0));
    ripples += hue(age) * line * fade;
  }
  color += ripples * mix(0.45, 1.0, uLive);

  // Finish: vignette, then fine film grain. Two samples summed give the soft,
  // bell-shaped grain of real film; it sits in the light, not the blacks.
  vec2 centered = uv * 2.0 - 1.0;
  color *= 1.0 - 0.24 * dot(centered, centered);
  vec2 cell = gl_FragCoord.xy + floor(uTime * 18.0 * uMotion) * vec2(37.0, 91.0);
  float grain = hash(cell) + hash(cell + 211.0) - 1.0;
  color += grain * (0.012 + 0.07 * sqrt(dot(color, vec3(0.3333))));
  outColor = vec4(color, 1.0);
}`;

type Rgb = [number, number, number];

export interface SceneInput {
  wave: ArrayLike<number>;
  spectrum: ArrayLike<number>;
  sampleRate: number;
}

export interface SceneOptions {
  /** The element the dial is drawn around. */
  anchor: HTMLElement;
  /**
   * What is playing right now; 'unreadable' when something plays but its
   * samples are private; null when nothing plays.
   */
  read: () => SceneInput | 'unreadable' | null;
  colors: Record<'ink' | 'amber' | 'ember' | 'cool', string>;
  reducedMotion: () => boolean;
}

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.trim().replace('#', ''), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compile(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile');
    }
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed to link');
  }
  return program;
}

/** The audio, reduced to what one frame draws. */
class Signal {
  /** One row per ring, newest first; each byte is a displacement, 128 meaning none. */
  readonly history = new Uint8Array(POINTS * RINGS).fill(128);
  /** How far the newest ring has travelled towards the next slot, 0 to 1. */
  phase = 0;
  live = 0;
  level = 0;
  bass = 0;
  private readonly bands = new Float32Array(8);
  private readonly ring = new Float32Array(POINTS);
  private peak = 0.1;
  private clock = 0;

  update(source: SceneInput | 'unreadable' | null, seconds: number, moving: boolean): void {
    this.clock += seconds;
    const input = source === 'unreadable' ? null : source;
    const audible = source === 'unreadable' || (input !== null && !isSilent(input.wave));
    const ease = (rate: number) => Math.min(1, seconds * rate);
    let loudness = 0;
    let low = 0;

    this.ring.fill(0);
    if (input && audible) {
      const peak = peakOf(input.wave);
      this.peak = trackPeak(this.peak, peak, seconds);
      const gain = displayGain(this.peak);
      const start = triggerIndex(input.wave, SPAN);
      const width = SPAN / POINTS;
      // Average neighbouring samples so a ring is a curve, not a scribble.
      for (let i = 0; i < POINTS; i++) {
        let sum = 0;
        for (let j = 0; j < width; j++) sum += input.wave[start + i * width + j] ?? 0;
        this.ring[i] = Math.max(-1, Math.min(1, (sum / width) * gain));
      }
      this.soften();
      pitchBands(input.spectrum, input.sampleRate, this.bands);
      low = (this.bands[0]! + this.bands[1]!) / 2;
      loudness = Math.min(1, peak * 1.4);
    } else if (source === 'unreadable') {
      // The station plays but its samples are private: a slow, even swell that is plainly not audio.
      for (let i = 0; i < POINTS; i++) {
        const turn = (i / (POINTS - 1)) * Math.PI;
        this.ring[i] = 0.3 * Math.sin(turn * 4 + this.clock * 1.1) * Math.cos(turn * 2 - this.clock * 0.6);
      }
      loudness = 0.35;
    }

    // Rings leave the dial at a steady pace, each carrying the waveform of its moment.
    this.phase += moving ? seconds / CADENCE : 0;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.history.copyWithin(POINTS, 0, POINTS * (RINGS - 1));
      for (let i = 0; i < POINTS; i++) this.history[i] = Math.round(128 + 127 * this.ring[i]!);
    }
    if (!moving) for (let i = 0; i < POINTS; i++) this.history[i] = Math.round(128 + 127 * this.ring[i]!);

    this.bass += (low * low - this.bass) * ease(low * low > this.bass ? 24 : 5);
    this.level += (loudness - this.level) * ease(4);
    this.live += ((audible ? 1 : 0) - this.live) * ease(5);
  }

  /** Two passes of neighbour averaging turn a jittery trace into a flowing contour. */
  private soften(): void {
    for (let pass = 0; pass < 2; pass++) {
      let before = this.ring[0]!;
      for (let i = 0; i < POINTS; i++) {
        const here = this.ring[i]!;
        const after = this.ring[Math.min(POINTS - 1, i + 1)]!;
        this.ring[i] = (before + 2 * here + after) / 4;
        before = here;
      }
    }
  }
}

type Draw = (signal: Signal, time: number) => void;

function createRenderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, options: SceneOptions): Draw {
  const program = compile(gl);
  const at = (name: string) => gl.getUniformLocation(program, name);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  // Smooth along a ring, exact between rings.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(program);
  gl.uniform1i(at('uHistory'), 0);
  for (const [name, hex] of [
    ['uInk', options.colors.ink],
    ['uAmber', options.colors.amber],
    ['uEmber', options.colors.ember],
    ['uCool', options.colors.cool],
  ] as const) {
    gl.uniform3fv(at(name), rgb(hex));
  }

  return (signal, time) => {
    const { width, height } = canvas;
    const still = options.reducedMotion();
    // Where the dial element sits, in drawing-buffer pixels with y pointing up.
    const scale = width / canvas.clientWidth;
    const box = options.anchor.getBoundingClientRect();
    const view = canvas.getBoundingClientRect();

    gl.viewport(0, 0, width, height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, POINTS, RINGS, 0, gl.RED, gl.UNSIGNED_BYTE, signal.history);
    gl.uniform2f(at('uResolution'), width, height);
    gl.uniform2f(
      at('uCenter'),
      (box.left + box.width / 2 - view.left) * scale,
      height - (box.top + box.height / 2 - view.top) * scale,
    );
    gl.uniform1f(at('uRadius'), (Math.min(box.width, box.height) / 2) * RING * scale);
    gl.uniform1f(at('uPhase'), signal.phase);
    gl.uniform1f(at('uTime'), still ? 0 : time);
    gl.uniform1f(at('uLevel'), signal.level);
    gl.uniform1f(at('uBass'), signal.bass);
    gl.uniform1f(at('uLive'), signal.live);
    gl.uniform1f(at('uMotion'), still ? 0 : 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

/** Returns false when WebGL2 is unavailable, so the page can show its plain dial. */
export function createScene(canvas: HTMLCanvasElement, options: SceneOptions): boolean {
  const signal = new Signal();
  let draw: Draw | undefined;
  let last = 0;

  const build = (): boolean => {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return false;
    try {
      draw = createRenderer(canvas, gl, options);
      return true;
    } catch {
      draw = undefined;
      return false;
    }
  };

  if (!build()) return false;

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    draw = undefined;
  });
  canvas.addEventListener('webglcontextrestored', build);

  new ResizeObserver(([entry]) => {
    if (!entry) return;
    // The scene is soft and grainy by nature; 1.5× is sharp enough and far cheaper than 3×.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(entry.contentRect.width * ratio));
    canvas.height = Math.max(1, Math.round(entry.contentRect.height * ratio));
  }).observe(canvas);

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const seconds = Math.min(0.1, (now - last) / 1000);
    last = now;
    signal.update(options.read(), seconds, !options.reducedMotion());
    draw?.(signal, now / 1000);
  };
  requestAnimationFrame(frame);
  return true;
}

/** Records a voice note: hold, speak, release. */

import { NOTE_MAX_SECONDS } from '../../lib/rooms/limits';

export interface Recording {
  audio: Blob;
  seconds: number;
}

/** Formats in order of how widely the result plays back; iPhones record the first. */
const FORMATS = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export const canRecord = () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Start recording. Resolves once the microphone is live, with a function that
 * stops and returns the note. It stops by itself at the length limit.
 */
export async function record(onTick: (seconds: number) => void, onLimit: () => void): Promise<() => Promise<Recording>> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const format = FORMATS.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const recorder = new MediaRecorder(stream, format ? { mimeType: format, audioBitsPerSecond: 32_000 } : undefined);
  const chunks: Blob[] = [];
  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;

  recorder.addEventListener('dataavailable', (event) => event.data.size && chunks.push(event.data));
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.start();

  const ticker = window.setInterval(() => {
    onTick(Math.min(elapsed(), NOTE_MAX_SECONDS));
    if (elapsed() >= NOTE_MAX_SECONDS) onLimit();
  }, 100);

  let result: Promise<Recording> | undefined;
  return () =>
    (result ??= (async () => {
      window.clearInterval(ticker);
      const seconds = Math.min(elapsed(), NOTE_MAX_SECONDS);
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      // Release the microphone at once, so the phone's "recording" mark goes away.
      for (const track of stream.getTracks()) track.stop();
      return { audio: new Blob(chunks, { type: recorder.mimeType }), seconds };
    })());
}

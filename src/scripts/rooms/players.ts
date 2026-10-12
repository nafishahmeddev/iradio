/**
 * The four things a room can play, behind one interface, so the rest of the
 * app never asks which is playing. Each kind keeps a single player for the
 * whole visit: a phone only lets sound start from a tap, and a player that
 * has been started once keeps that permission for the songs that follow.
 */

import { STEADY_MS } from '../../lib/rooms/limits';
import { fileTitle } from '../../lib/rooms/links';
import type { Source } from '../../lib/rooms/room';

export interface RoomPlayer {
  /** Load an item, ready to play from the start. */
  load: (source: Source) => Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  position: () => Promise<number>;
  /** 0 to 1. */
  volume: (level: number) => void;
  playing: () => boolean;
  /** Playing without a break for long enough that its position can be judged. */
  settled: () => boolean;
  /** Shown in the room's frame, or null for audio with no picture. */
  readonly picture: HTMLElement | null;
}

export interface Details {
  title: string;
  seconds: number;
  image?: string;
}

interface Hooks {
  /** The item cannot be played on this device; the reason is a short code such as `youtube-150`. */
  failed: (reason: string) => void;
}

// ------------------------------------------------------------------ loading the outside players

declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement, options: unknown) => YouTubeApi; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
    SC?: { Widget: ((frame: HTMLIFrameElement) => SoundCloudApi) & { Events: Record<string, string> } };
  }
}

interface YouTubeApi {
  loadVideoById: (id: string) => void;
  cueVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setVolume: (percent: number) => void;
  mute: () => void;
  getVideoData: () => { title?: string; isLive?: boolean };
  destroy: () => void;
}

interface SoundCloudApi {
  bind: (event: string, handler: (data?: unknown) => void) => void;
  load: (url: string, options: Record<string, unknown>) => void;
  play: () => void;
  pause: () => void;
  seekTo: (ms: number) => void;
  setVolume: (percent: number) => void;
  getPosition: (callback: (ms: number) => void) => void;
  getDuration: (callback: (ms: number) => void) => void;
  getCurrentSound: (callback: (sound: { title?: string; artwork_url?: string; user?: { username?: string } } | null) => void) => void;
  isPaused: (callback: (paused: boolean) => void) => void;
}

const scripts = new Map<string, Promise<void>>();

function script(src: string, ready: () => boolean, hook?: (done: () => void) => void): Promise<void> {
  let loading = scripts.get(src);
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      if (ready()) return resolve();
      const tag = document.createElement('script');
      tag.src = src;
      tag.onerror = () => {
        scripts.delete(src);
        reject(new Error(`Could not load ${src}`));
      };
      if (hook) hook(resolve);
      else tag.onload = () => resolve();
      document.head.append(tag);
    });
    scripts.set(src, loading);
  }
  return loading;
}

const youtubeApi = () =>
  script('https://www.youtube.com/iframe_api', () => Boolean(window.YT?.Player), (done) => {
    window.onYouTubeIframeAPIReady = done;
  });

const soundcloudApi = () => script('https://w.soundcloud.com/player/api.js', () => Boolean(window.SC?.Widget));

const TIMEOUT_MS = 15_000;
const timeout = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([work, new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('Timed out')), TIMEOUT_MS))]);

// ------------------------------------------------------------------ YouTube

function youtube(hooks: Hooks): RoomPlayer {
  const picture = document.createElement('div');
  const slot = document.createElement('div');
  picture.append(slot);
  let api: YouTubeApi | undefined;
  let cued: (() => void) | undefined;
  /** When the player last started, stopped or began buffering. */
  let changedAt = 0;
  const isPlaying = () => api?.getPlayerState() === window.YT?.PlayerState['PLAYING'];

  const start = async (id: string) => {
    await youtubeApi();
    await new Promise<void>((resolve) => {
      // The player object exists before it can be used; it is only kept once YouTube says it is ready.
      const made: YouTubeApi = new window.YT!.Player(slot, {
        videoId: id,
        width: '100%',
        height: '100%',
        // The room, not the viewer, decides where the song is, so the player's own controls are off.
        playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, fs: 0 },
        events: {
          onReady: () => {
            api = made;
            resolve();
          },
          onStateChange: (event: { data: number }) => {
            changedAt = performance.now();
            if (event.data === window.YT!.PlayerState['CUED']) cued?.();
          },
          onError: (event: { data: number }) => hooks.failed(`youtube-${event.data}`),
        },
      });
    });
  };

  return {
    picture,
    async load(source) {
      if (source.kind !== 'youtube') return;
      if (!api) return timeout(start(source.id));
      await timeout(
        new Promise<void>((resolve) => {
          cued = resolve;
          api!.cueVideoById(source.id);
        }),
      );
    },
    play: () => api?.playVideo(),
    pause: () => api?.pauseVideo(),
    seek: (seconds) => api?.seekTo(seconds, true),
    position: async () => api?.getCurrentTime() ?? Number.NaN,
    volume: (level) => api?.setVolume(Math.round(level * 100)),
    // Buffering counts: it is what a playing video does for a moment after jumping to a new position.
    playing: () => {
      const state = api?.getPlayerState();
      return state === window.YT?.PlayerState['PLAYING'] || state === window.YT?.PlayerState['BUFFERING'];
    },
    // Buffering does not count here: a video still loading is not where it will be once it plays.
    settled: () => isPlaying() && performance.now() - changedAt > STEADY_MS,
  };
}

// ------------------------------------------------------------------ SoundCloud

function soundcloud(hooks: Hooks): RoomPlayer {
  const picture = document.createElement('iframe');
  picture.allow = 'autoplay';
  picture.title = 'SoundCloud player';
  let api: SoundCloudApi | undefined;
  let paused = true;

  const bind = () => {
    const events = window.SC!.Widget.Events;
    api!.bind(events['PLAY']!, () => (paused = false));
    api!.bind(events['PAUSE']!, () => (paused = true));
    api!.bind(events['FINISH']!, () => (paused = true));
    api!.bind(events['ERROR']!, () => hooks.failed('soundcloud'));
  };

  return {
    picture,
    async load(source) {
      if (source.kind !== 'soundcloud') return;
      await soundcloudApi();
      await timeout(
        new Promise<void>((resolve) => {
          const options = { auto_play: false, show_comments: false, hide_related: true, visual: true };
          if (api) {
            api.load(source.url, { ...options, callback: resolve });
            return;
          }
          picture.src = `https://w.soundcloud.com/player/?${new URLSearchParams({ url: source.url, auto_play: 'false', visual: 'true', hide_related: 'true', show_comments: 'false' })}`;
          api = window.SC!.Widget(picture);
          api.bind(window.SC!.Widget.Events['READY']!, () => {
            bind();
            resolve();
          });
        }),
      );
    },
    play: () => api?.play(),
    pause: () => api?.pause(),
    seek: (seconds) => api?.seekTo(seconds * 1000),
    position: () => new Promise((resolve) => (api ? api.getPosition((ms) => resolve(ms / 1000)) : resolve(0))),
    // SoundCloud's player has no speed control.
    volume: (level) => api?.setVolume(Math.round(level * 100)),
    playing: () => !paused,
    settled: () => !paused,
  };
}

// ------------------------------------------------------------------ audio files and stations

function audio(hooks: Hooks): RoomPlayer {
  const element = new Audio();
  element.preload = 'auto';
  element.addEventListener('error', () => element.src && hooks.failed(`audio-${element.error?.code ?? 0}`));
  return {
    picture: null,
    load(source) {
      const url = source.kind === 'file' ? source.url : source.kind === 'station' ? source.station.url : '';
      return timeout(
        new Promise<void>((resolve, reject) => {
          element.onloadedmetadata = () => resolve();
          element.onerror = () => reject(new Error('Could not load'));
          element.src = url;
          element.load();
          // A live station has nothing to wait for.
          if (source.kind === 'station') resolve();
        }),
      );
    },
    play: () => void element.play().catch(() => undefined),
    pause: () => element.pause(),
    seek: (seconds) => {
      if (Number.isFinite(element.duration)) element.currentTime = Math.min(seconds, element.duration);
    },
    position: async () => element.currentTime,
    volume: (level) => {
      element.volume = level;
    },
    playing: () => !element.paused && !element.ended,
    settled: () => !element.paused && !element.ended && !element.seeking && element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
  };
}

// ------------------------------------------------------------------ the set of players

export type Kind = Source['kind'];

/** One player per kind, made the first time it is needed. Files and stations share one. */
export function createPlayers(hooks: Hooks): (kind: Kind) => RoomPlayer {
  const made = new Map<string, RoomPlayer>();
  return (kind) => {
    const key = kind === 'station' ? 'file' : kind;
    let player = made.get(key);
    if (!player) {
      player = key === 'youtube' ? youtube(hooks) : key === 'soundcloud' ? soundcloud(hooks) : audio(hooks);
      made.set(key, player);
    }
    return player;
  };
}

// ------------------------------------------------------------------ reading a link's details before adding it

/** Title, length and picture of a link, read on this device. Rejects if it cannot be played here. */
export async function readDetails(source: Exclude<Source, { kind: 'station' }>): Promise<Details> {
  if (source.kind === 'file') {
    const probe = new Audio();
    probe.preload = 'metadata';
    await timeout(
      new Promise<void>((resolve, reject) => {
        probe.onloadedmetadata = () => resolve();
        probe.onerror = () => reject(new Error('unplayable'));
        probe.src = source.url;
      }),
    );
    // A late joiner must be able to jump to the right place.
    const seekable = Number.isFinite(probe.duration) && probe.seekable.length > 0 && probe.seekable.end(0) > 0;
    probe.removeAttribute('src');
    if (!seekable) throw new Error('unseekable');
    return { title: fileTitle(source.url), seconds: probe.duration };
  }

  // The outside players only reveal a song's details once it is loaded, so load it out of sight.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:200px;';
  document.body.append(holder);
  try {
    if (source.kind === 'youtube') {
      await youtubeApi();
      const slot = document.createElement('div');
      holder.append(slot);
      return await timeout(
        new Promise<Details>((resolve, reject) => {
          const player: YouTubeApi = new window.YT!.Player(slot, {
            playerVars: { playsinline: 1 },
            events: {
              onReady: () => {
                player.mute();
                player.cueVideoById(source.id);
              },
              onStateChange: (event: { data: number }) => {
                if (event.data !== window.YT!.PlayerState['CUED']) return;
                const data = player.getVideoData();
                resolve({
                  title: data.title || 'YouTube video',
                  seconds: data.isLive ? 0 : player.getDuration(),
                  image: `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg`,
                });
                player.destroy();
              },
              onError: () => reject(new Error('unplayable')),
            },
          });
        }),
      );
    }

    await soundcloudApi();
    const frame = document.createElement('iframe');
    frame.allow = 'autoplay';
    frame.src = `https://w.soundcloud.com/player/?${new URLSearchParams({ url: source.url, auto_play: 'false' })}`;
    holder.append(frame);
    const widget = window.SC!.Widget(frame);
    return await timeout(
      new Promise<Details>((resolve, reject) => {
        widget.bind(window.SC!.Widget.Events['ERROR']!, () => reject(new Error('unplayable')));
        widget.bind(window.SC!.Widget.Events['READY']!, () => {
          widget.getCurrentSound((sound) => {
            if (!sound) return reject(new Error('unplayable'));
            widget.getDuration((ms) => {
              const details: Details = {
                title: [sound.user?.username, sound.title].filter(Boolean).join(' · ') || 'SoundCloud track',
                seconds: ms / 1000,
              };
              if (sound.artwork_url?.startsWith('https:')) details.image = sound.artwork_url;
              resolve(details);
            });
          });
        });
      }),
    );
  } finally {
    holder.remove();
  }
}

/** Recognises what can be queued from a pasted link. */

export type LinkSource =
  | { kind: 'youtube'; id: string }
  | { kind: 'soundcloud'; url: string }
  | { kind: 'file'; url: string };

export type LinkProblem = 'unknown' | 'soundcloud-set';

const YOUTUBE_ID = /^[\w-]{11}$/;
const AUDIO_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;

export function parseLink(input: string): LinkSource | LinkProblem {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return 'unknown';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'unknown';
  const host = url.hostname.replace(/^(www|m|music)\./, '');

  if (host === 'youtube.com' || host === 'youtu.be') {
    const id =
      host === 'youtu.be'
        ? url.pathname.slice(1)
        : url.pathname === '/watch'
          ? url.searchParams.get('v')
          : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1];
    return id && YOUTUBE_ID.test(id) ? { kind: 'youtube', id } : 'unknown';
  }

  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    if (host === 'on.soundcloud.com') return { kind: 'soundcloud', url: `https://on.soundcloud.com${url.pathname}` };
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[1] === 'sets') return 'soundcloud-set';
    return parts.length === 2 ? { kind: 'soundcloud', url: `https://soundcloud.com/${parts[0]}/${parts[1]}` } : 'unknown';
  }

  // A secure page cannot load http:// audio, so only https files are accepted.
  if (url.protocol === 'https:' && AUDIO_FILE.test(url.pathname)) return { kind: 'file', url: url.href };
  return 'unknown';
}

/** A readable title for an audio file that carries none. */
export function fileTitle(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  return name.replace(AUDIO_FILE, '').replace(/[_-]+/g, ' ').trim() || 'Audio';
}

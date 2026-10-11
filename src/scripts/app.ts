/** The interface: state, rendering and input. */

import { GAIN_STEP_DB, MAX_GAIN_DB, PAGE_SIZE, VOLUME_STEP } from '../lib/config';
import { Favorites } from '../lib/favorites';
import { duration } from '../lib/format';
import { parseOptions, readSettings, SETTINGS_KEY } from '../lib/options';
import { stationId, type Station, type StationQuery } from '../lib/stations';
import { countryName } from '../lib/world';
import { fetchStations } from './directory';
import { Player } from './player';
import { createScene } from './scene';

const TOP = 'Top worldwide';
/** The public radio directory has no popularity ranking; it offers a tour of the world instead. */
const TOUR = 'Around the world';
const SAVED = 'Saved stations';

type Kind = 'top' | 'country' | 'genre' | 'search' | 'saved';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

/** localStorage can be unavailable (private windows, blocked site data). */
const storage: Pick<Storage, 'getItem' | 'setItem'> = (() => {
  try {
    window.localStorage.getItem(SETTINGS_KEY);
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
})();

const options = parseOptions(window.location.search);
const settings = { ...readSettings(storage.getItem(SETTINGS_KEY)) };
if (options.volume !== undefined) settings.volume = options.volume;
if (options.gainDb !== undefined) settings.gainDb = options.gainDb;

const favorites = new Favorites(storage);
const player = new Player(settings.volume, settings.gainDb, () => render());

const state = {
  kind: 'top' as Kind,
  mode: TOP,
  query: {} as StationQuery,
  /** The query the visible list belongs to; null while showing saved stations. */
  shown: null as StationQuery | null,
  stations: [] as Station[],
  selected: 0,
  offset: 0,
  /** False once a page came back short, so there is nothing after it. */
  more: true,
  loading: false,
  loadError: '',
  /** The catalogue that answered for the visible list. */
  source: null as string | null,
};

if (options.country) {
  state.query.countrycode = options.country;
  state.kind = 'country';
  state.mode = countryName(options.country);
}
if (options.search) {
  state.query.name = options.search;
  state.kind = 'search';
  state.mode = `“${options.search}”`;
}

const view = {
  mode: element('mode'),
  count: element('count'),
  search: element<HTMLInputElement>('search-input'),
  list: element<HTMLUListElement>('stations'),
  card: element<HTMLTemplateElement>('station-template'),
  skeleton: element('skeleton'),
  empty: element('empty'),
  emptyTitle: element('empty-title'),
  emptyHint: element('empty-hint'),
  retry: element('retry'),
  pager: element('pager'),
  page: element('page'),
  badge: element('badge'),
  badgeText: element('badge-text'),
  title: element('title'),
  meta: element('meta'),
  clock: element('clock'),
  art: element('art'),
  artMono: element('art-mono'),
  artImage: element<HTMLImageElement>('art-image'),
  barArt: element('bar-art'),
  barMono: element('bar-mono'),
  barImage: element<HTMLImageElement>('bar-image'),
  barTitle: element('bar-title'),
  barMeta: element('bar-meta'),
  boost: element<HTMLButtonElement>('boost'),
  boostValue: element('boost-value'),
  volume: element<HTMLInputElement>('volume'),
  volumeValue: element('volume-value'),
  toast: element('toast'),
  countryDialog: element<HTMLDialogElement>('country-dialog'),
  countries: element('countries'),
  countryFilter: element<HTMLInputElement>('country-filter'),
  countryNone: element('country-none'),
  genreDialog: element<HTMLDialogElement>('genre-dialog'),
  genreForm: element<HTMLFormElement>('genre-form'),
  genreInput: element<HTMLInputElement>('genre-input'),
  genres: element('genres'),
  helpDialog: element<HTMLDialogElement>('help-dialog'),
};

const selectedStation = () => state.stations[state.selected];
/** The station's country by its short everyday name, whichever catalogue it came from. */
const place = (station: Station) =>
  station.countrycode ? countryName(station.countrycode) : station.country;

const plural = (count: number) => `${count} ${count === 1 ? 'station' : 'stations'}`;

let toastTimer = 0;

/** A short message that shows itself out. */
function toast(message: string): void {
  if (!message) return;
  view.toast.textContent = message;
  view.toast.classList.add('is-showing');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => view.toast.classList.remove('is-showing'), 2800);
}

/** A station's initial and a colour of its own, for when it has no artwork. */
function monogram(name: string): { letter: string; hue: number } {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  const letter = Array.from(name).find((char) => /[\p{L}\p{N}]/u.test(char)) ?? '♪';
  return { letter: letter.toUpperCase(), hue: hash };
}

/** Show a station's artwork in a .logo element, falling back to its monogram. */
function showLogo(holder: HTMLElement, label: Element, image: HTMLImageElement, station: Station): void {
  const { letter, hue } = monogram(station.name);
  holder.style.setProperty('--hue', String(hue));
  label.textContent = letter;
  image.removeAttribute('data-loaded');
  if (station.logo) image.src = station.logo;
  else image.removeAttribute('src');
}

// ---------------------------------------------------------------- directory

let request: AbortController | undefined;

function load(offset = 0): void {
  request?.abort();
  const controller = (request = new AbortController());
  const query = { ...state.query };
  if (JSON.stringify(query) !== JSON.stringify(state.shown)) {
    state.stations = [];
    state.selected = state.offset = 0;
    state.more = true;
    state.source = null;
  }
  state.shown = query;
  state.loading = true;
  state.loadError = '';
  render();

  fetchStations(query, offset, state.source, controller.signal).then(
    ({ stations, source }) => {
      // A newer request or a switch to saved stations makes this answer outdated.
      if (controller.signal.aborted) return;
      state.loading = false;
      if (!stations.length && offset > state.offset) {
        state.more = false;
        toast('That was the last page.');
      } else {
        state.stations = stations;
        state.source = source;
        state.offset = offset;
        state.selected = 0;
        state.more = stations.length >= PAGE_SIZE;
      }
      render();
    },
    (error: unknown) => {
      if (controller.signal.aborted) return;
      state.loading = false;
      state.loadError = error instanceof Error ? error.message : String(error);
      render();
    },
  );
}

function browse(kind: Kind, mode: string, query: StationQuery): void {
  if (kind !== 'search') view.search.value = '';
  state.kind = kind;
  state.mode = mode;
  state.query = query;
  load();
}

function showFavorites(): void {
  request?.abort();
  state.loading = false;
  state.loadError = '';
  state.source = null;
  state.shown = null;
  state.kind = 'saved';
  state.mode = SAVED;
  state.stations = [...favorites.stations];
  state.offset = state.selected = 0;
  view.search.value = '';
  render();
}

// ------------------------------------------------------------------ actions

function select(index: number): void {
  const last = Math.max(0, state.stations.length - 1);
  state.selected = Math.max(0, Math.min(last, index));
  render();
}

function play(): void {
  const station = selectedStation();
  if (!station) return;
  player.play(station);
}

function pause(): void {
  player.pause();
}

/** The dial button: resume or pause what is on, otherwise tune in to the selection. */
function toggle(): void {
  if (['playing', 'paused', 'connecting'].includes(player.state)) pause();
  else if (player.current) player.play(player.current);
  else play();
}

function saveSettings(): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ volume: player.volume, gainDb: player.gainDb }));
  } catch {
    // The setting still applies for this visit.
  }
}

function setVolume(volume: number): void {
  player.setVolume(volume);
  saveSettings();
  render();
}

/** Boost steps up through its levels and wraps back to off. */
function cycleBoost(): void {
  const next = player.gainDb + GAIN_STEP_DB;
  player.setGain(next > MAX_GAIN_DB ? 0 : next);
  saveSettings();
  toast(player.gainDb ? `Boost +${player.gainDb} dB` : 'Boost off');
  render();
}

/** Tune in to the station before or after the selected one. */
function step(by: number): void {
  select(state.selected + by);
  play();
}

function toggleFavorite(station: Station | null | undefined): void {
  if (!station) return;
  try {
    toast(favorites.toggle(station) ? `Saved ${station.name}` : `Removed ${station.name}`);
  } catch {
    toast('This browser would not save your stations.');
  }
  if (state.kind === 'saved') {
    state.stations = [...favorites.stations];
    state.selected = Math.min(state.selected, Math.max(0, state.stations.length - 1));
  }
  render();
}

function openGenres(): void {
  view.genreInput.value = '';
  view.genreDialog.showModal();
}

const title = (text: string) => text.replace(/^./, (first) => first.toUpperCase());

function filterCountries(): void {
  const wanted = view.countryFilter.value.trim().toLowerCase();
  let shown = 0;
  for (const region of view.countries.querySelectorAll<HTMLElement>('.region')) {
    let inRegion = 0;
    for (const item of region.querySelectorAll<HTMLElement>('li')) {
      const { name = '', code = '' } = item.querySelector<HTMLElement>('.country')!.dataset;
      const match = name.toLowerCase().includes(wanted) || code.toLowerCase() === wanted;
      item.hidden = !match;
      if (match) inRegion++;
    }
    region.hidden = inRegion === 0;
    shown += inRegion;
  }
  view.countryNone.hidden = shown > 0;
}

function openCountries(): void {
  view.countryFilter.value = '';
  filterCountries();
  view.countryDialog.showModal();
  view.countries.scrollTop = 0;
  view.countryFilter.focus();
}

function chooseCountry(button: HTMLElement): void {
  view.countryDialog.close();
  browse('country', button.dataset['name']!, { countrycode: button.dataset['code']! });
}

const paging = () => state.kind !== 'saved' && !state.loading;

const actions: Record<string, () => void> = {
  toggle,
  stop: () => player.stop(),
  'favorite-current': () => toggleFavorite(player.current),
  favorites: showFavorites,
  search: () => view.search.focus(),
  genre: openGenres,
  boost: cycleBoost,
  'previous-station': () => step(-1),
  'next-station': () => step(1),
  country: openCountries,
  top: () => browse('top', TOP, {}),
  help: () => view.helpDialog.showModal(),
  next: () => paging() && state.more && load(state.offset + PAGE_SIZE),
  previous: () => paging() && state.offset > 0 && load(Math.max(0, state.offset - PAGE_SIZE)),
  refresh: () => paging() && load(state.offset),
};

/** Why an action cannot run right now, or '' when it can. */
function blocked(action: string): string {
  const busy = state.loading ? 'Still loading' : '';
  switch (action) {
    case 'toggle':
      return player.current || state.stations.length ? '' : 'Pick a station first';
    case 'stop':
    case 'favorite-current':
      return player.current ? '' : 'Nothing is playing';
    case 'previous':
      return busy || (state.offset > 0 ? '' : 'This is the first page');
    case 'next':
      return busy || (state.more && state.stations.length ? '' : 'This is the last page');
    case 'refresh':
      return busy;
    case 'boost':
      return player.state === 'playing' && !player.readableAudio
        ? 'This station does not share its audio, so it cannot be boosted'
        : '';
    case 'previous-station':
      return state.stations.length && state.selected > 0 ? '' : 'No earlier station';
    case 'next-station':
      return state.selected < state.stations.length - 1 ? '' : 'No later station';
    default:
      return '';
  }
}

// ---------------------------------------------------------------- rendering

/** The list the grid was last built from; the grid is rebuilt only when this changes. */
let built: Station[] | null = null;
let builtKind: Kind | null = null;

function buildGrid(): void {
  const cards = state.stations.map((station, index) => {
    const card = (view.card.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    card.id = `station-${index}`;
    card.dataset['index'] = String(index);
    card.style.setProperty('--order', String(index));
    showLogo(
      card.querySelector<HTMLElement>('.logo')!,
      card.querySelector('.logo-mono')!,
      card.querySelector('img')!,
      station,
    );
    card.querySelector('.card-name')!.textContent = station.name;
    // In a country's own list the country goes without saying; show the genre instead.
    card.querySelector('.card-meta')!.textContent =
      (state.kind === 'country' ? '' : place(station)) || station.tags.split(', ')[0] || 'Radio';
    return card;
  });
  view.list.replaceChildren(...cards);
  view.list.scrollTop = 0;
}

/** Which card is on air and which are saved: updated in place, never by rebuilding. */
function renderMarks(): void {
  const current = player.current ? stationId(player.current) : null;
  for (const [index, card] of [...view.list.children].entries()) {
    const station = state.stations[index];
    if (!station) continue;
    const saved = favorites.contains(station);
    card.toggleAttribute('data-playing', stationId(station) === current);
    const heart = card.querySelector<HTMLElement>('.card-fav')!;
    heart.toggleAttribute('data-on', saved);
    heart.setAttribute('aria-label', saved ? `Remove ${station.name}` : `Save ${station.name}`);
  }
}

/** How many cards sit in one row of the grid right now. */
function columns(): number {
  const [first, ...rest] = view.list.children as HTMLCollectionOf<HTMLElement>;
  if (!first) return 1;
  const next = rest.findIndex((card) => card.offsetTop !== first.offsetTop);
  return next < 0 ? rest.length + 1 : next + 1;
}

let selectedShown = -1;

function renderSelection(): void {
  for (const card of view.list.children) {
    card.setAttribute('aria-selected', String(card.id === `station-${state.selected}`));
  }
  const active = view.list.children[state.selected];
  if (!active) {
    view.list.removeAttribute('aria-activedescendant');
    return;
  }
  view.list.setAttribute('aria-activedescendant', active.id);
  // Follow the selection only when it moves, so other updates never tug the scroll position.
  if (selectedShown !== state.selected) active.scrollIntoView({ block: 'nearest' });
  selectedShown = state.selected;
}

function renderLibrary(): void {
  const count = state.stations.length;
  const waiting = state.loading && count === 0;
  view.mode.textContent = state.kind === 'top' && state.source === 'iprd' ? TOUR : state.mode;
  view.count.textContent = state.loading ? 'Loading…' : count ? plural(count) : '';
  view.list.hidden = count === 0;
  view.list.style.opacity = state.loading ? '0.4' : '';
  view.skeleton.hidden = !waiting;
  view.empty.hidden = count > 0 || state.loading;
  view.retry.hidden = !state.loadError;
  if (state.loadError) {
    view.emptyTitle.textContent = 'The station catalogues are not answering';
    view.emptyHint.textContent = 'Check your connection, then try again.';
  } else if (state.kind === 'saved') {
    view.emptyTitle.textContent = 'Your collection starts here';
    view.emptyHint.textContent = 'Tap the heart on any station to keep it.';
  } else {
    view.emptyTitle.textContent = 'No stations found';
    view.emptyHint.textContent = 'Try another name, genre or country.';
  }
  view.pager.hidden =
    state.kind === 'saved' || (state.offset === 0 && !state.more);
  view.page.textContent = String(state.offset / PAGE_SIZE + 1);
  for (const place of document.querySelectorAll<HTMLElement>('[data-kind]')) {
    place.setAttribute('aria-pressed', String(place.dataset['kind'] === state.kind));
  }
}

const BADGES = {
  idle: 'Ready',
  connecting: 'Tuning in',
  playing: 'On air',
  paused: 'Paused',
  stopped: 'Broadcast ended',
  error: 'No signal',
} as const;

let artShown: string | null = null;

function renderPlayer(): void {
  const current = player.current;
  const failed = player.state === 'error';
  view.badge.dataset['state'] = player.state;
  view.badgeText.textContent = BADGES[player.state];
  view.title.textContent = current ? current.name : 'Find your frequency.';
  view.meta.textContent = !current
    ? 'Stations from every corner of the world'
    : failed
      ? 'Not answering. Try again, or pick another'
      : [place(current), current.bitrate ? `${current.bitrate} kbps` : '', current.tags]
          .filter(Boolean)
          .join('  ·  ') || 'Internet radio';
  view.barTitle.textContent = current ? current.name : 'Nothing playing';
  view.barMeta.textContent = current
    ? failed
      ? 'Not answering'
      : place(current) || current.tags || 'Internet radio'
    : 'Pick a station';
  document.title = current ? `${current.name} · iRadio` : 'iRadio';

  // The artwork only changes with the station, so the images are not reloaded on every render.
  const art = current ? stationId(current) : '';
  if (art !== artShown) {
    artShown = art;
    for (const [holder, label, image] of [
      [view.art, view.artMono, view.artImage],
      [view.barArt, view.barMono, view.barImage],
    ] as const) {
      if (current) showLogo(holder, label, image, current);
      else {
        holder.style.removeProperty('--hue');
        label.textContent = '';
        image.removeAttribute('data-loaded');
        image.removeAttribute('src');
      }
    }
  }

  const label =
    player.state === 'playing' || player.state === 'connecting'
      ? 'Pause'
      : current
        ? `Play ${current.name}`
        : 'Play the selected station';
  for (const button of document.querySelectorAll<HTMLElement>('[data-action="toggle"]')) {
    button.dataset['state'] = player.state;
    button.setAttribute('aria-label', label);
  }

  const saved = current !== null && favorites.contains(current);
  const heart = document.querySelector<HTMLElement>('[data-action="favorite-current"]')!;
  heart.setAttribute('aria-pressed', String(saved));
  heart.setAttribute('aria-label', saved ? 'Remove this station' : 'Save this station');

  view.boost.toggleAttribute('data-on', player.gainDb > 0);
  view.boostValue.textContent = player.gainDb ? `+${player.gainDb}` : '';
  view.boost.setAttribute(
    'aria-label',
    player.gainDb ? `Boost for quiet stations, now +${player.gainDb} dB` : 'Boost for quiet stations, now off',
  );
  view.volume.value = String(player.volume);
  view.volume.style.setProperty('--fill', `${player.volume}%`);
  view.volumeValue.textContent = `${player.volume}%`;
}

function renderControls(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
    const reason = blocked(button.dataset['action']!);
    button.disabled = reason !== '';
    button.title = reason || button.getAttribute('aria-label') || '';
  }
}

/** The clock ticks every animation frame while a station is on. */
function renderClock(): void {
  const text = player.current && player.state !== 'error' ? duration(player.elapsed) : '';
  if (view.clock.textContent !== text) view.clock.textContent = text;
}

function render(): void {
  if (built !== state.stations || builtKind !== state.kind) {
    built = state.stations;
    builtKind = state.kind;
    selectedShown = -1;
    buildGrid();
  }
  renderMarks();
  renderSelection();
  renderLibrary();
  renderPlayer();
  renderControls();
  renderClock();
}

// -------------------------------------------------------------------- input

document.addEventListener('click', (event) => {
  const target = event.target as Element;
  const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
  if (action) return actions[action]?.();
  const card = target.closest<HTMLElement>('.card');
  if (!card) return;
  const index = Number(card.dataset['index']);
  if (target.closest('.card-fav')) return toggleFavorite(state.stations[index]);
  select(index);
  play();
});

view.volume.addEventListener('input', () => setVolume(view.volume.valueAsNumber));

// Artwork shows once it has loaded; a missing or broken image leaves the monogram.
for (const event of ['load', 'error'] as const) {
  document.addEventListener(
    event,
    ({ target }) => {
      if (target instanceof HTMLImageElement && target.closest('.logo')) {
        target.toggleAttribute('data-loaded', event === 'load');
      }
    },
    true,
  );
}

// Search as you type, once the typing pauses.
let searchTimer = 0;

function search(): void {
  window.clearTimeout(searchTimer);
  const value = view.search.value.trim();
  if (value.length >= 2) browse('search', `“${value}”`, { name: value });
  else if (!value && state.kind === 'search') browse('top', TOP, {});
}

view.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(search, 350);
});

view.search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search();
  else if (event.key === 'ArrowDown') view.list.focus();
  else if (event.key === 'Escape') {
    view.search.value = '';
    search();
    view.search.blur();
  } else return;
  event.preventDefault();
});

view.genreForm.addEventListener('submit', () => {
  const value = view.genreInput.value.trim();
  if (value) browse('genre', title(value), { tag: value });
});

view.countries.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('[data-code]');
  if (button) chooseCountry(button);
});

view.countryFilter.addEventListener('input', filterCountries);

// Enter in the filter picks the first country still showing.
view.countryFilter.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  // Otherwise the same key press lands on the button that focus returns to and reopens the dialog.
  event.preventDefault();
  const first = view.countries.querySelector<HTMLElement>('li:not([hidden]) .country');
  if (first) chooseCountry(first);
});

view.genres.addEventListener('click', (event) => {
  const genre = (event.target as Element).closest<HTMLElement>('[data-genre]')?.dataset['genre'];
  if (!genre) return;
  view.genreDialog.close();
  browse('genre', title(genre), { tag: genre });
});

// Clicking the dimmed backdrop closes a dialog, as people expect.
for (const dialog of [view.genreDialog, view.countryDialog, view.helpDialog]) {
  dialog.addEventListener('click', (event) => event.target === dialog && dialog.close());
}

const keys: Record<string, () => void> = {
  ArrowLeft: () => select(state.selected - 1),
  ArrowRight: () => select(state.selected + 1),
  ArrowUp: () => select(state.selected - columns()),
  k: () => select(state.selected - columns()),
  ArrowDown: () => select(state.selected + columns()),
  j: () => select(state.selected + columns()),
  Home: () => select(0),
  End: () => select(state.stations.length - 1),
  Enter: play,
  ' ': pause,
  '+': () => setVolume(player.volume + VOLUME_STEP),
  '=': () => setVolume(player.volume + VOLUME_STEP),
  '-': () => setVolume(player.volume - VOLUME_STEP),
  s: actions['stop']!,
  c: actions['country']!,
  '/': actions['search']!,
  g: actions['genre']!,
  f: () => toggleFavorite(selectedStation()),
  b: actions['favorites']!,
  t: actions['top']!,
  ']': actions['next']!,
  '[': actions['previous']!,
  r: actions['refresh']!,
  '?': actions['help']!,
};

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) {
    // ? toggles the shortcuts; every other key belongs to the open dialog.
    if (event.key === '?' && view.helpDialog.open) view.helpDialog.close();
    return;
  }
  const target = event.target as HTMLElement;
  if (target.matches('input, textarea, select')) return;
  // A focused button keeps its own Enter and Space.
  if (target.matches('button') && (event.key === 'Enter' || event.key === ' ')) return;
  const handler = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!handler) return;
  event.preventDefault();
  handler();
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', pause);
  navigator.mediaSession.setActionHandler('pause', pause);
  navigator.mediaSession.setActionHandler('stop', () => player.stop());
}

// -------------------------------------------------------------------- start

const tokens = getComputedStyle(document.documentElement);
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

const drawing = createScene(element<HTMLCanvasElement>('scene'), {
  anchor: element('dial'),
  read: () => player.read(),
  colors: {
    ink: tokens.getPropertyValue('--color-ink'),
    amber: tokens.getPropertyValue('--color-amber'),
    ember: tokens.getPropertyValue('--color-ember'),
    cool: tokens.getPropertyValue('--color-cool'),
  },
  reducedMotion: () => motion.matches,
});
document.documentElement.classList.toggle('no-webgl', !drawing);

const tick = () => {
  renderClock();
  requestAnimationFrame(tick);
toast(favorites.warning);
};

load();
requestAnimationFrame(tick);
toast(favorites.warning);

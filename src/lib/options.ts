/** Start-up options from the page address, mirroring the CLI flags. */

import { DEFAULT_VOLUME, MAX_GAIN_DB } from './config';
import { clamp } from './format';
import { isCountryCode } from './stations';

export interface Options {
  country?: string;
  search?: string;
  volume?: number;
  gainDb?: number;
}

function number(value: string | null, low: number, high: number): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, low, high) : undefined;
}

/** `?country=IN&search=jazz&volume=60&gain=6`; anything invalid is ignored. */
export function parseOptions(search: string): Options {
  const params = new URLSearchParams(search);
  const options: Options = {};
  const country = params.get('country');
  if (country && isCountryCode(country)) options.country = country.toUpperCase();
  const name = params.get('search')?.trim().slice(0, 100);
  if (name) options.search = name;
  const volume = number(params.get('volume'), 0, 100);
  if (volume !== undefined) options.volume = Math.round(volume);
  const gainDb = number(params.get('gain'), 0, MAX_GAIN_DB);
  if (gainDb !== undefined) options.gainDb = gainDb;
  return options;
}

export const SETTINGS_KEY = 'iradio.settings';

export interface Settings {
  volume: number;
  gainDb: number;
}

export function readSettings(saved: string | null): Settings {
  const settings: Settings = { volume: DEFAULT_VOLUME, gainDb: 0 };
  try {
    const data: unknown = JSON.parse(saved ?? 'null');
    if (typeof data === 'object' && data !== null) {
      const { volume, gainDb } = data as Record<string, unknown>;
      if (typeof volume === 'number' && Number.isFinite(volume)) {
        settings.volume = Math.round(clamp(volume, 0, 100));
      }
      if (typeof gainDb === 'number' && Number.isFinite(gainDb)) {
        settings.gainDb = clamp(gainDb, 0, MAX_GAIN_DB);
      }
    }
  } catch {
    // Unreadable settings fall back to the defaults.
  }
  return settings;
}

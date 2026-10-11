/** Validated favorites; a failed save never changes what is in memory. */

import { stationId, toStations, type Station } from './stations';

export const FAVORITES_KEY = 'iradio.favorites';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export class Favorites {
  stations: Station[] = [];
  warning = '';

  constructor(
    private readonly store: Store,
    private readonly key = FAVORITES_KEY,
  ) {
    try {
      const saved = store.getItem(key);
      if (saved !== null) this.stations = toStations(JSON.parse(saved));
    } catch (error) {
      this.warning = `Favorites could not be read: ${error instanceof Error ? error.message : error}`;
    }
  }

  contains(station: Station): boolean {
    return this.stations.some((saved) => stationId(saved) === stationId(station));
  }

  /** Returns true when the station was added, false when removed. Throws if saving fails. */
  toggle(station: Station): boolean {
    const added = !this.contains(station);
    const updated = added
      ? [...this.stations, station]
      : this.stations.filter((saved) => stationId(saved) !== stationId(station));
    this.store.setItem(this.key, JSON.stringify(updated));
    this.stations = updated;
    return added;
  }
}

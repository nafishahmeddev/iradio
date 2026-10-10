"""Validated favorites with atomic file replacement."""

import json
import os
import tempfile
from pathlib import Path


def station_id(station):
    return station.get("stationuuid") or station.get("url_resolved") or station.get("url")


class Favorites:
    def __init__(self, path):
        self.path = Path(path)
        self.stations = []
        self.warning = ""
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                raise ValueError("Expected a list of stations")
            self.stations = [s for s in data if isinstance(s, dict) and station_id(s)]
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as exc:
            self.warning = f"Favorites could not be read: {exc}"

    def contains(self, station):
        return any(station_id(s) == station_id(station) for s in self.stations)

    def toggle(self, station):
        added = not self.contains(station)
        updated = (
            self.stations + [station]
            if added
            else [s for s in self.stations if station_id(s) != station_id(station)]
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.path.parent, delete=False
            ) as handle:
                temporary = handle.name
                json.dump(updated, handle, indent=2, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
        self.stations = updated
        return added

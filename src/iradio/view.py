"""Responsive terminal composition: station library and listening deck."""

import curses
import time
import unicodedata

from .animation import activity, duration, spinner
from .favorites import station_id
from .waveform import waveform


def cell_width(text):
    return sum(
        0
        if unicodedata.combining(char)
        else 2
        if unicodedata.east_asian_width(char) in ("W", "F")
        else 1
        for char in text
    )


def fit(text, width):
    """Clip by terminal cells so wide station names cannot cross panel borders."""
    result, used = [], 0
    for char in str(text):
        if not char.isprintable() and not unicodedata.combining(char):
            char = " "
        size = cell_width(char)
        if used + size > width:
            break
        result.append(char)
        used += size
    return "".join(result)


class View:
    def __init__(self, app):
        self.app = app

    def style(self, name, bold=False):
        return self.app.colors.get(name, 0) | (curses.A_BOLD if bold else 0)

    def text(self, y, x, value, width, style="text", bold=False):
        self.app.put(y, x, fit(value, max(0, width)), self.style(style, bold), width)

    def panel(self, y, x, height, width, title):
        if height < 3 or width < 4:
            return
        for row in range(y + 1, y + height - 1):
            self.text(row, x, "│" + " " * (width - 2) + "│", width, "border")
        self.text(y, x, "╭" + "─" * (width - 2) + "╮", width, "border")
        self.text(y + height - 1, x, "╰" + "─" * (width - 2) + "╯", width, "border")
        self.text(y, x + 2, f" {title} ", width - 4, "accent", True)

    def library(self, y, x, height, width, now):
        app = self.app
        self.panel(y, x, height, width, "STATION LIBRARY")
        compact = height < 7
        if not compact:
            self.text(y + 1, x + 2, app.mode, width - 4, "text", True)
        label = (
            f"{spinner(now)} Finding stations"
            if app.loading
            else (f"{len(app.stations)} stations  ·  page {app.offset // 50 + 1}")
        )
        if not compact:
            self.text(y + 2, x + 2, label, width - 4, "muted")
        step = 2 if height >= 15 and width >= 38 else 1
        list_start = 1 if compact else 4
        visible = max(1, (height - list_start - (2 if height >= 8 else 1)) // step)
        app.selected = max(0, min(app.selected, len(app.stations) - 1))
        app.scroll = max(0, min(app.scroll, app.selected))
        if app.selected >= app.scroll + visible:
            app.scroll = app.selected - visible + 1
        if not app.stations:
            title = (
                "Finding your frequency…"
                if app.loading
                else "Connection interrupted"
                if app.load_error
                else "Your collection starts here"
                if app.mode == "Favorites"
                else "No stations found"
            )
            self.text(y + list_start, x + 2, title, width - 4, "accent")
            if height > 8:
                hint = "R to retry" if app.load_error else "T browse  ·  F save a station"
                self.text(y + 6, x + 2, hint, width - 4, "muted")
        current = station_id(app.player.current) if app.player.current else None
        for row, station in enumerate(app.stations[app.scroll : app.scroll + visible]):
            position = app.scroll + row
            line = y + list_start + row * step
            active = position == app.selected
            playing = current is not None and station_id(station) == current
            mark = "▶" if playing else "♥" if app.favorites.contains(station) else " "
            style = "selected" if active else "text"
            self.text(line, x + 1, " " * (width - 2), width - 2, style)
            self.text(
                line,
                x + 2,
                f"{'›' if active else ' '} {mark} {station.get('name', 'Untitled')}",
                width - 4,
                style,
                active,
            )
            if step == 2:
                self.text(
                    line + 1,
                    x + 6,
                    f"{station.get('countrycode') or 'WORLD'}  ·  "
                    f"{station.get('bitrate', 0)} kbps  ·  "
                    f"{station.get('tags') or 'Radio'}",
                    width - 8,
                    "muted",
                )
        if app.stations and height >= 8:
            self.text(
                y + height - 2,
                x + 2,
                f"{app.selected + 1:02} / {len(app.stations):02}    ↑↓ select · Enter tune in",
                width - 4,
                "muted",
            )

    def deck(self, y, x, height, width, now):
        app, player = self.app, self.app.player
        self.panel(y, x, height, width, "ON AIR")
        current = player.current
        state = (
            "PAUSED" if player.paused else player.state.upper() if current else "READY TO LISTEN"
        )
        badge = f"{spinner(now)} CONNECTING" if state == "CONNECTING" else f"● {state}"
        self.text(y + 1, x + 2, badge, width - 4, "warm" if player.paused else "good", True)
        title = str(current.get("name") or "Untitled") if current else "Find your frequency."
        available = width - 4
        if cell_width(title) > available and current:
            loop = title + "   /   "
            shift = int(now * 2) % len(loop)
            title = (loop + loop)[shift:]
        if height <= 5:
            self.text(y + 1, x + 2, f"{state} · {title}", available, "text", True)
        else:
            self.text(y + 2, x + 2, title, available, "text", True)
        if height >= 11:
            country = (
                current.get("country") or "Worldwide"
                if current
                else "Thousands of stations. One dial."
            )
            self.text(y + 3, x + 2, country, available, "muted")
        wave_height = min(5, max(2, height - 12)) if height >= 11 else 1
        wave_y = y + (5 if height >= 17 else 4) if height >= 11 else y + (2 if height <= 5 else 3)
        samples = player.samples if player.state == "playing" and not player.paused else []
        peak = max((abs(value) for value in samples), default=0.0)
        app.wave_peak = max(peak, app.wave_peak * 0.97, 0.01)
        gain = min(8.0, max(1.0, 0.85 / app.wave_peak))
        for row, value in enumerate(waveform(samples, available, wave_height, gain), wave_y):
            self.text(row, x + 2, value, available, "wave")
        if height >= 11:
            self.text(
                wave_y + wave_height + 1,
                x + 2,
                f"{duration(player.elapsed)}  /  LIVE" if current else "SELECT A STATION TO BEGIN",
                available,
                "accent",
            )
        if height >= 17:
            self.text(
                y + height - 5,
                x + 2,
                f"{current.get('bitrate', 0)} kbps  ·  MP3  ·  Preamp +{player.gain_db:g} dB"
                if current
                else "C countries  ·  / search  ·  B saved",
                available,
                "muted",
            )
            self.text(
                y + height - 4,
                x + 2,
                current.get("tags") or "Internet radio"
                if current
                else "Your next favorite is out there.",
                available,
                "muted",
            )
        volume_y = y + height - 3 if height >= 11 else y + height - 2
        bar_width = max(5, min(20, width - 20))
        filled = round(player.volume / 100 * bar_width)
        self.text(
            volume_y,
            x + 2,
            f"VOL  {'━' * filled}{'─' * (bar_width - filled)}  {player.volume}%",
            available,
            "accent",
        )
        if height >= 11:
            self.text(
                volume_y + 1, x + 2, "Space pause  ·  +/- volume  ·  S stop", available, "muted"
            )

    def draw(self):
        app = self.app
        screen = app.screen
        screen.erase()
        h, w = screen.getmaxyx()
        now = time.monotonic()
        app.player.poll_events()
        if h < 16 or w < 48:
            self.text(0, 0, "iRadio / Please resize to 48 × 16", w - 1, "accent", True)
            self.text(2, 0, "Q quit · Audio continues while resizing", w - 1, "muted")
            screen.refresh()
            return
        self.text(1, 2, "◉  i r a d i o", 20, "accent", True)
        if w >= 76:
            self.text(1, 24, "A WORLD OF SOUND", w - 48, "muted")
        self.text(1, w - 21, "? help  ·  Q quit", 19, "muted")
        wide = w >= 100
        if wide:
            left = max(40, int((w - 7) * 0.46))
            self.library(3, 2, h - 7, left, now)
            self.deck(3, left + 4, h - 7, w - left - 6, now)
        else:
            deck_height = 11 if h >= 24 else 7 if h >= 22 else 5
            library_height = h - deck_height - 7
            self.library(3, 2, library_height, w - 4, now)
            self.deck(3 + library_height, 2, deck_height, w - 4, now)
        if w >= 76:
            controls = "↑↓ browse   Enter play   / search   C country   G genre   F save   B saved"
        else:
            controls = "↑↓ browse  Enter play  / search  C country"
        self.text(h - 3, 2, controls, w - 4, "text")
        self.text(
            h - 2,
            2,
            "T discover   [ ] pages   R refresh   Space pause   +/- volume"
            if w >= 76
            else "B saved  F save  T top  [ ] pages  ? more",
            w - 4,
            "muted",
        )
        status = app.status
        if app.loading:
            elapsed = now - app.loading_started
            status = f"{spinner(now)} {activity(elapsed, 10)} Finding stations · {elapsed:.0f}s"
        elif app.player.state == "error":
            status = "Stream unavailable · Enter retry or choose another station"
        elif app.player.state == "stopped" and app.player.current:
            status = "Stream ended · Enter reconnect"
        self.text(h - 1, 2, status, w - 4, "warm" if app.load_error else "muted")
        screen.refresh()

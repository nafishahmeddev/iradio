"""Curses interface with background directory loading."""

import curses
import queue
import threading
import time

from .animation import activity, duration, spinner
from .api import RadioAPI
from .config import COUNTRIES, PAGE_SIZE
from .favorites import Favorites
from .player import Player
from .waveform import waveform


def clean(value):
    return "".join(c if c.isprintable() else " " for c in str(value))


def cursor(visible):
    try:
        curses.curs_set(int(visible))
    except curses.error:
        pass


class Interface:
    def __init__(self, screen, args):
        self.screen = screen
        self.api = RadioAPI()
        self.favorites = Favorites(args.favorites_file)
        self.player = Player(args.volume, args.output, args.device)
        self.stations = []
        self.selected = self.scroll = self.offset = 0
        self.query = {}
        self.display_query = {}
        self.mode = "Top worldwide"
        if args.country:
            self.query["countrycode"] = args.country.upper()
            self.mode = args.country.upper()
        if args.search:
            self.query["name"] = args.search
            self.mode = f"Search: {args.search}"
        self.status = self.favorites.warning or "Find your next favorite station"
        self.results = queue.Queue()
        self.generation = 0
        self.loading = False
        self.loading_started = time.monotonic()
        self.colors = {}
        if curses.has_colors():
            curses.start_color()
            try:
                curses.use_default_colors()
                background = -1
            except curses.error:
                background = curses.COLOR_BLACK
            for index, (name, color) in enumerate(
                [
                    ("accent", curses.COLOR_CYAN),
                    ("good", curses.COLOR_GREEN),
                    ("muted", curses.COLOR_BLUE),
                    ("warm", curses.COLOR_YELLOW),
                ],
                1,
            ):
                curses.init_pair(index, color, background)
                self.colors[name] = curses.color_pair(index)

    def put(self, y, x, text, attr=0, width=None):
        h, w = self.screen.getmaxyx()
        if 0 <= y < h and 0 <= x < w - 1:
            try:
                self.screen.addnstr(
                    y, x, clean(text), min(w - x - 1, width if width is not None else w), attr
                )
            except curses.error:
                pass

    def fetch(self, offset=0):
        self.generation += 1
        generation = self.generation
        query = dict(self.query)
        if query != self.display_query or self.mode == "Top worldwide" and self.display_query:
            self.stations = []
            self.selected = self.scroll = self.offset = 0
        self.display_query = query
        self.loading = True
        self.loading_started = time.monotonic()
        self.status = "Loading stations... You can still browse or quit."

        def worker():
            try:
                self.results.put((generation, offset, self.api.search(query, offset), None))
            except Exception as exc:
                self.results.put((generation, offset, None, str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def receive(self):
        while True:
            try:
                generation, offset, stations, error = self.results.get_nowait()
            except queue.Empty:
                break
            if generation != self.generation:
                continue
            self.loading = False
            if error:
                self.status = f"{error} • R retry"
            elif not stations and offset > self.offset:
                self.status = "No more stations. You are still on the last available page."
            else:
                self.stations = stations
                self.offset = offset
                self.selected = self.scroll = 0
                self.status = f"{len(stations)} stations loaded • ? for all controls"

    def draw(self):
        screen = self.screen
        screen.erase()
        h, w = screen.getmaxyx()
        now = time.monotonic()
        self.player.poll_events()
        accent = self.colors.get("accent", 0)
        if h < 16 or w < 48:
            self.put(0, 0, "iRadio | Enlarge terminal to at least 48 x 16", curses.A_BOLD)
            self.put(2, 0, "Q quit | Playback continues while resizing")
            screen.refresh()
            return
        self.put(0, 2, "iRADIO", accent | curses.A_BOLD)
        self.put(0, 11, " /  YOUR WORLD, ON AIR", curses.A_DIM)
        self.put(
            1,
            2,
            "[ BROWSE ]   [ B SAVED ]   [ / SEARCH ]   [ ? HELP ]",
            accent if w >= 60 else curses.A_DIM,
        )
        self.put(2, 2, self.mode, curses.A_BOLD, w - 24)
        self.put(
            2,
            max(25, w - 20),
            f"{spinner(now)} LOADING"
            if self.loading
            else f"PAGE {self.offset // PAGE_SIZE + 1}  /  {len(self.stations)}",
            accent,
        )
        self.put(3, 2, "─" * (w - 4), accent)
        self.put(4, 2, "   #  STATION", curses.A_DIM)
        if w >= 76:
            self.put(4, w - 24, "COUNTRY   KBPS", curses.A_DIM)
        expanded = h >= 22
        wave_height = 3 if h >= 26 else 1
        footer_height = (10 + wave_height) if expanded else 8
        visible = h - footer_height - 5
        self.selected = max(0, min(self.selected, len(self.stations) - 1))
        self.scroll = max(0, min(self.scroll, self.selected))
        if self.selected >= self.scroll + visible:
            self.scroll = self.selected - visible + 1
        for row, station in enumerate(self.stations[self.scroll : self.scroll + visible]):
            index = self.scroll + row
            active = index == self.selected
            attr = curses.A_REVERSE | curses.A_BOLD if active else 0
            self.put(5 + row, 2, " " * (w - 4), attr)
            current = self.player.current
            playing = current and (current.get("url_resolved") or current.get("url")) == (
                station.get("url_resolved") or station.get("url")
            )
            star = "▶" if playing else "★" if self.favorites.contains(station) else " "
            self.put(
                5 + row,
                2,
                f"{star} {index + 1:3}  {station.get('name', 'Unknown')}",
                attr,
                w - 28 if w >= 76 else w - 5,
            )
            if w >= 76:
                self.put(
                    5 + row,
                    w - 24,
                    f"{station.get('countrycode', '--'):7}   {station.get('bitrate', 0)}k",
                    attr,
                )
        if not self.stations:
            self.put(
                6,
                4,
                "Loading the directory..."
                if self.loading
                else (
                    "No favorites yet. Browse with T and press F to save."
                    if self.mode == "Favorites"
                    else "No matches. Try / search or T top stations."
                ),
                curses.A_DIM,
            )
        base = h - footer_height
        self.put(base, 2, "─" * (w - 4), accent)
        current = self.player.current
        state = self.player.state.upper()
        if self.player.paused:
            state = "PAUSED"
        label = f"{spinner(now)} CONNECTING" if state == "CONNECTING" else state
        title = (
            clean(current.get("name", "Unknown")) if current else "Choose a station • Enter to play"
        )
        title_width = max(8, w - len(label) - 8)
        if len(title) > title_width and current:
            loop = title + "   •   "
            shift = int(now * 3) % len(loop)
            title = (loop + loop)[shift : shift + title_width]
        self.put(
            base + 1,
            2,
            f"{label if current else 'READY'}  {title}",
            self.colors.get("good", 0) | curses.A_BOLD,
        )
        bars = round(self.player.volume / 10)
        self.put(
            base + 2, 2, f"VOL {'━' * bars}{'─' * (10 - bars)} {self.player.volume:3}%", accent
        )
        self.put(
            base + 2,
            26,
            f"{duration(self.player.elapsed)} / LIVE" if current else "LIVE RADIO",
            curses.A_DIM,
        )
        if expanded:
            self.put(base + 3, 2, "AUDIO WAVEFORM / PCM", curses.A_DIM)
            samples = (
                self.player.samples
                if self.player.state == "playing" and not self.player.paused
                else []
            )
            for row, line in enumerate(waveform(samples, w - 5, wave_height), base + 4):
                self.put(row, 2, line, accent)
            detail = "No stream selected"
            if current:
                detail = (
                    f"{current.get('country', '--')} • {current.get('bitrate', 0)} kbps • "
                    + str(current.get("tags") or "Internet radio")
                )
            self.put(base + 4 + wave_height, 2, detail, curses.A_DIM)
        hint_start = base + (5 + wave_height if expanded else 3)
        if w >= 76:
            hints = (
                "↑↓/jk Browse   Enter Play   Space Pause   +/- Volume",
                "/ Search  C Country  G Genre  F Save  B Saved  T Top",
                "[ ] Pages   R Refresh   S Stop   ? Help   Q Quit",
            )
        else:
            hints = (
                "↑↓ Select  Enter Play  Space Pause  +/- Vol",
                "/ Search  C Country  F Save  B Saved",
                "[ ] Page  S Stop  T Top  ? Help  Q Quit",
            )
        for row, hint in enumerate(hints, hint_start):
            self.put(row, 2, hint, curses.A_DIM)
        status = self.status
        if self.loading:
            elapsed = now - self.loading_started
            status = (
                f"{spinner(now)} {activity(elapsed, 12)} Loading stations • {elapsed:.0f}s • Q quit"
            )
        elif self.player.state == "error":
            status = "Stream unavailable • Enter to retry or choose another station"
        elif self.player.state == "stopped" and current:
            status = "Stream ended • Enter to reconnect"
        self.put(h - 2, 2, "─" * (w - 4), curses.A_DIM)
        self.put(h - 1, 2, status, self.colors.get("warm", 0))
        screen.refresh()

    def prompt(self, label):
        value = ""
        cursor(True)
        try:
            while True:
                self.receive()
                self.draw()
                h, w = self.screen.getmaxyx()
                self.screen.move(h - 1, 0)
                self.screen.clrtoeol()
                prefix = f"{label}: " if w >= 76 else "Search: "
                available = max(1, w - len(prefix) - 3)
                self.put(h - 1, 1, prefix + value[-available:])
                self.screen.refresh()
                try:
                    key = self.screen.get_wch()
                except curses.error:
                    continue
                if key in ("\n", "\r", curses.KEY_ENTER):
                    return value.strip()
                if key == "\x1b":
                    return ""
                if key in (curses.KEY_BACKSPACE, "\x7f", "\b"):
                    value = value[:-1]
                elif isinstance(key, str) and key.isprintable() and len(value) < 100:
                    value += key
        finally:
            cursor(False)

    def help(self):
        lines = [
            "↑↓ / j k   Select a station",
            "Enter      Play selected station",
            "Space      Pause / resume",
            "+ / -      Adjust volume",
            "/          Search station names",
            "C          Choose country",
            "G          Search genre",
            "F          Save / remove favorite",
            "B          Open favorites",
            "T          Top worldwide stations",
            "[ / ]      Previous / next page",
            "R          Retry / refresh",
            "S          Stop playback",
            "Q          Quit the app",
            "Esc        Cancel a search or picker",
        ]
        start = 0
        while True:
            self.screen.erase()
            h, _ = self.screen.getmaxyx()
            self.put(0, 2, "iRADIO / KEYBOARD GUIDE", curses.A_BOLD)
            self.put(1, 2, "↑↓ scroll • Esc / ? close", curses.A_DIM)
            visible = max(1, h - 3)
            for row, line in enumerate(lines[start : start + visible], 3):
                self.put(row, 2, line)
            self.screen.refresh()
            key = self.screen.getch()
            if key in (27, ord("?"), ord("q"), ord("Q")):
                return
            if key == curses.KEY_DOWN:
                start = min(max(0, len(lines) - visible), start + 1)
            elif key == curses.KEY_UP:
                start = max(0, start - 1)

    def country_picker(self):
        selected = 0
        while True:
            self.screen.erase()
            h, w = self.screen.getmaxyx()
            self.put(0, 2, "CHOOSE A COUNTRY", curses.A_BOLD | self.colors.get("accent", 0))
            self.put(1, 2, "↑↓ or j/k select • Enter choose • Esc cancel", curses.A_DIM)
            visible = max(1, h - 4)
            start = max(0, selected - visible + 1)
            for row, (name, code) in enumerate(COUNTRIES[start : start + visible]):
                self.put(
                    row + 3,
                    2,
                    f"{code}  {name}",
                    curses.A_REVERSE if start + row == selected else 0,
                )
            self.screen.refresh()
            key = self.screen.getch()
            if key in (27, ord("q"), ord("Q")):
                return
            if key in (curses.KEY_UP, ord("k")):
                selected = max(0, selected - 1)
            if key in (curses.KEY_DOWN, ord("j")):
                selected = min(len(COUNTRIES) - 1, selected + 1)
            if key in (10, 13, curses.KEY_ENTER):
                self.mode, code = COUNTRIES[selected]
                self.query = {"countrycode": code}
                self.fetch()
                return

    def handle(self, key):
        if key in (ord("q"), ord("Q")):
            return False
        if key == ord("?"):
            self.help()
        elif key in (curses.KEY_UP, ord("k")):
            self.selected = max(0, self.selected - 1)
        elif key in (curses.KEY_DOWN, ord("j")):
            self.selected = min(max(0, len(self.stations) - 1), self.selected + 1)
        elif key in (10, 13, curses.KEY_ENTER) and self.stations:
            self.player.play(self.stations[self.selected])
            self.status = "Stream requested; press Space to pause"
        elif key == ord(" "):
            self.player.pause()
            self.status = (
                ("Paused" if self.player.paused else "Stream resumed")
                if self.player.current
                else "Select a station and press Enter first"
            )
        elif key in (ord("+"), ord("="), ord("-")):
            self.player.change_volume(-5 if key == ord("-") else 5)
            self.status = f"Volume {self.player.volume}%"
        elif key in (ord("s"), ord("S")):
            self.player.stop()
            self.status = "Playback stopped"
        elif key in (ord("c"), ord("C")):
            self.country_picker()
        elif key in (ord("/"), ord("g"), ord("G")):
            genre = key != ord("/")
            value = self.prompt("Genre" if genre else "Station name (Esc cancels)")
            if value:
                self.query = {"tag" if genre else "name": value}
                self.mode = f"{'Genre' if genre else 'Search'}: {value}"
                self.fetch()
        elif key in (ord("f"), ord("F")) and self.stations:
            added = self.favorites.toggle(self.stations[self.selected])
            self.status = "Saved to favorites" if added else "Removed from favorites"
            if self.mode == "Favorites":
                self.stations = list(self.favorites.stations)
                self.selected = min(self.selected, max(0, len(self.stations) - 1))
        elif key in (ord("b"), ord("B")):
            self.generation += 1
            self.loading = False
            self.display_query = None
            self.mode = "Favorites"
            self.stations = list(self.favorites.stations)
            self.offset = self.selected = self.scroll = 0
            self.status = "Your saved stations • T returns to top stations"
        elif key in (ord("t"), ord("T")):
            self.mode, self.query = "Top worldwide", {}
            self.fetch()
        elif self.mode != "Favorites" and not self.loading:
            if key == ord("]"):
                self.fetch(self.offset + PAGE_SIZE)
            elif key == ord("["):
                self.fetch(max(0, self.offset - PAGE_SIZE))
            elif key in (ord("r"), ord("R")):
                self.fetch(self.offset)
        return True


def run(screen, args):
    cursor(False)
    screen.keypad(True)
    screen.timeout(100)
    app = Interface(screen, args)
    app.fetch()
    try:
        while True:
            app.receive()
            if app.player.process and app.player.process.poll() is not None:
                app.player.stop()
                app.status = "Player exited. Select another station to reconnect."
            app.draw()
            try:
                if not app.handle(screen.getch()):
                    break
            except (OSError, ValueError) as exc:
                app.status = f"Action failed: {exc}"
    finally:
        app.player.stop()

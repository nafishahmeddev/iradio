"""Curses interface with background directory loading."""

import curses
import queue
import threading
import time

from .api import RadioAPI
from .config import COUNTRIES, PAGE_SIZE
from .favorites import Favorites
from .player import Player
from .view import View, fit


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
        self.player = Player(args.volume, args.output, args.device, getattr(args, "gain_db", 0.0))
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
        self.load_error = None
        self.loading_started = time.monotonic()
        self.wave_peak = 0.1
        self.colors = {}
        if curses.has_colors():
            curses.start_color()
            try:
                curses.use_default_colors()
                background = -1
            except curses.error:
                background = curses.COLOR_BLACK
            rich = curses.COLORS >= 256
            palette = [
                ("text", 252 if rich else curses.COLOR_WHITE, background),
                ("accent", 81 if rich else curses.COLOR_CYAN, background),
                ("good", 114 if rich else curses.COLOR_GREEN, background),
                ("muted", 245 if rich else curses.COLOR_WHITE, background),
                ("warm", 221 if rich else curses.COLOR_YELLOW, background),
                ("border", 240 if rich else curses.COLOR_BLUE, background),
                ("wave", 141 if rich else curses.COLOR_MAGENTA, background),
                ("selected", 16 if rich else curses.COLOR_BLACK, 81 if rich else curses.COLOR_CYAN),
            ]
            for index, (name, foreground, bg) in enumerate(palette, 1):
                if index >= curses.COLOR_PAIRS:
                    break
                curses.init_pair(index, foreground, bg)
                self.colors[name] = curses.color_pair(index)
        self.view = View(self)

    def put(self, y, x, text, attr=0, width=None):
        h, w = self.screen.getmaxyx()
        if 0 <= y < h and 0 <= x < w - 1:
            try:
                self.screen.addnstr(
                    y,
                    x,
                    fit(clean(text), min(w - x - 1, width if width is not None else w)),
                    w - x - 1,
                    attr,
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
        self.load_error = None
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
                self.load_error = error
                self.status = f"{error} • R retry"
            elif not stations and offset > self.offset:
                self.status = "No more stations. You are still on the last available page."
            else:
                self.stations = stations
                self.offset = offset
                self.selected = self.scroll = 0
                self.status = f"{len(stations)} stations loaded • ? for all controls"

    def draw(self):
        self.view.draw()

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
            self.load_error = None
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
    screen.timeout(50)
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

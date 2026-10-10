"""Command-line configuration and terminal lifecycle."""

import argparse
import os
import shutil
import sys
from pathlib import Path

from . import __version__
from .config import FAVORITES_PATH


def main(argv=None):
    parser = argparse.ArgumentParser(description="iRadio — internet radio in your terminal")
    parser.add_argument("--version", action="version", version=f"iRadio {__version__}")
    parser.add_argument("--country", metavar="CODE", help="initial two-letter country code")
    parser.add_argument("--search", metavar="NAME", help="initial station search")
    parser.add_argument("--volume", type=int, default=70, metavar="0-100")
    parser.add_argument("--output", help="mpg123 output backend, e.g. alsa")
    parser.add_argument("--device", help="audio device, e.g. plughw:0,0")
    parser.add_argument("--favorites-file", type=Path, default=FAVORITES_PATH)
    args = parser.parse_args(argv)
    if not 0 <= args.volume <= 100:
        parser.error("--volume must be between 0 and 100")
    if args.country and (len(args.country) != 2 or not args.country.isalpha()):
        parser.error("--country must be a two-letter country code")
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print(
            "iRadio needs an interactive terminal. Run iradio --help for options.", file=sys.stderr
        )
        return 1
    if not all(shutil.which(tool) for tool in ("mpg123", "out123")):
        print(
            "mpg123 and out123 are required (both come with mpg123). macOS: brew install mpg123; "
            "Debian/Ubuntu: sudo apt install mpg123",
            file=sys.stderr,
        )
        return 1
    if os.environ.get("TERM") in (None, "dumb"):
        print("Use a terminal with TERM set (e.g. xterm-256color).", file=sys.stderr)
        return 1
    try:
        import curses

        from .ui import run

        curses.wrapper(run, args)
    except KeyboardInterrupt:
        return 0
    except (ImportError, OSError) as exc:
        print(f"Unable to start iRadio: {exc}", file=sys.stderr)
        return 1
    except curses.error as exc:
        print(f"Terminal error: {exc}", file=sys.stderr)
        return 1
    return 0

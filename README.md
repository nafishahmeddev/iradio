# iRadio

A keyboard-driven terminal internet radio player using Radio Browser and mpg123.
Requires Python 3.9+ and a macOS or Linux terminal. There are no Python runtime dependencies.

## Setup

Install the audio player:

```sh
# macOS
brew install mpg123
# Debian / Ubuntu
sudo apt install mpg123
```

Create an isolated Python environment and install the package:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e .
iradio
```

You can also run `python main.py` or, after installation, `python -m iradio`.
Use a terminal of at least 48 columns and 16 rows; 80×24 or larger shows more detail.

```sh
iradio --country IN --volume 60
iradio --search jazz
iradio --output alsa --device plughw:0,0
iradio --favorites-file ./favorites.json
iradio --help
```

Audio uses mpg123's system default output unless explicitly configured. The directory
filters for MP3 stations. Network requests run in the background with server failover;
changing views discards outdated responses. Playback state and decoded elapsed time come from mpg123's remote protocol. The
animated bars are an ambient visual effect, not an audio spectrum or volume meter.
Live streams have no fixed duration, so the timer shows elapsed time alongside LIVE.
Loading uses a spinner and moving activity bar rather than an estimated percentage.
At 22 rows or more, the playback panel also shows station metadata and animation;
smaller terminals use compact controls. Long playing-station titles scroll.


## Controls

| Key | Action |
| --- | --- |
| ↑ / ↓ or k / j | Select station |
| Enter | Play |
| Space | Pause / resume |
| + / - | Adjust volume |
| / | Search station names |
| C | Choose a country from a visible list |
| G | Search a genre |
| F | Toggle selected favorite |
| B | Show favorites |
| T | Top worldwide stations |
| [ / ] | Previous / next page |
| R | Refresh current directory page |
| S | Stop |
| ? | Open scrollable keyboard help |
| Q | Quit |
| Esc | Cancel search or country selection |

Favorites retain the prototype's `~/.haaki_radio_favorites.json` location and are
saved with atomic replacement. Read errors appear in the UI; save errors do not
change the in-memory favorites.

## Project layout

```text
main.py                 Compatibility launcher
pyproject.toml          Package metadata, CLI entry point, development tools
src/iradio/
  __init__.py           Package version
  __main__.py           python -m iradio entry point
  cli.py                Arguments and startup checks
  config.py             Defaults and country shortcuts
  api.py                Station directory transport
  favorites.py          Persistent favorites
  player.py             Audio process lifecycle
  ui.py                 Terminal UI and input handling
tests/                  Offline behavioral tests
```

## Development

```sh
python -m pip install -e '.[dev]'
python -m unittest discover -s tests -v
ruff check .
```

Tests use temporary files and mocked network/audio calls. Live streaming needs an
internet connection and an installed mpg123 player. Native Windows terminals are
not supported by this curses interface.

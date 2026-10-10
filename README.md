# iRadio

[![License: MIT](https://img.shields.io/badge/license-MIT-81d4fa)](LICENSE)
[![CI](https://github.com/nafishahmeddev/iradio/actions/workflows/ci.yml/badge.svg)](https://github.com/nafishahmeddev/iradio/actions/workflows/ci.yml)

Browse the world. Tune in. See the sound.

A keyboard-driven terminal internet radio player using Radio Browser and mpg123.
Requires mpg123 with its companion out123, Python 3.9+ and a macOS or Linux terminal. There are no Python runtime dependencies.

## Features

- Explore stations by country, name, or genre, with saved favorites.
- A responsive station library and listening deck with a real PCM waveform.
- Keyboard navigation, search dialogs, and live playback feedback.
- Configurable output devices, volume, and optional audio preamp gain.
- No Python runtime dependencies; macOS and Linux terminal support.

This is an early-stage project. Station availability depends on the external
directory and broadcasters. Native Windows terminals are not supported.

## Setup

Clone the source repository before running the setup commands:

```sh
git clone https://github.com/nafishahmeddev/iradio.git
cd iradio
```


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
iradio --check-country SA
iradio --check-country BD
```

Audio uses out123's system default output unless explicitly configured. The directory
filters for MP3 stations. Network requests run in the background with server failover;
changing views discards outdated responses. Playback state and decoded elapsed time come from mpg123's remote protocol. The
waveform uses actual signed PCM samples from the same decoder that feeds out123
for playback. It is a waveform, not a frequency spectrum. Stereo audio is mixed
to mono for display; playback remains stereo. Braille cells provide four vertical
pixels per terminal row. Automatic display gain (up to 8×) makes quieter audio
visible without changing playback volume; gain recovers gradually after loud peaks. Pauses and stale audio show a flat line.
Live streams have no fixed duration, so the timer shows elapsed time alongside LIVE.
Loading uses a spinner and moving activity bar rather than an estimated percentage.
At 100 columns or more, a station library and listening deck sit side by side.
Narrower terminals stack the panels; compact layouts retain a waveform and volume
control. The listening deck shows playback state, station details and a violet PCM
waveform. Long station titles scroll. Search, country selection and keyboard help
open centered dialogs. Use 110×30 or larger for the full listening deck.


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
  player.py             Decoder, PCM forwarding, audio process lifecycle
  waveform.py           Signed PCM waveform rendering
  view.py               Responsive panels and visual theme
  ui.py                 Terminal UI and input handling
tests/                  Offline behavioral tests
```

## Development

```sh
python -m pip install -e '.[dev]'
python -m unittest discover -s tests -v
ruff check .
ruff format --check .
python -m build
python -m twine check dist/*
```

Tests use temporary files and mocked network/audio calls. Live streaming needs an
internet connection and an installed mpg123 player. Native Windows terminals are
not supported by this curses interface.

## Diagnosing country loading

Run `iradio --check-country SA` or `iradio --check-country BD` to test the same
directory request without the terminal UI or audio playback. A network failure
is reported separately from an empty result; in the app press R to retry. Results
are MP3-only and capped at 50 per page. A directory listing does not guarantee
that every station stream is online.

## Quiet audio / MAX98357A

The app starts at 70% software volume. First try `iradio --volume 100`.
For an ALSA/I²S setup, select your configured device explicitly:

```sh
iradio --output alsa --device plughw:0,0 --volume 100
```

If the stream is still quiet, add an audio preamp:

```sh
iradio --output alsa --device plughw:0,0 --volume 100 --gain-db 6
```

Use the device identifier from your working speaker test; `plughw:0,0` is an
example. Audio gain is adjustable from 0 to 12 dB and uses soft clipping. Reduce
it if sound distorts. This changes actual playback amplitude; waveform display
gain only changes the drawing. The app does not adjust the system ALSA mixer.

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation, and PR guidance.
Use [GitHub issues](https://github.com/nafishahmeddev/iradio/issues) for bugs and
feature requests. Follow the [code of conduct](CODE_OF_CONDUCT.md). Report
vulnerabilities according to [SECURITY.md](SECURITY.md). See
[CHANGELOG.md](CHANGELOG.md) for changes.

## License and acknowledgments

Licensed under the [MIT License](LICENSE).

Station discovery is provided by [Radio Browser](https://www.radio-browser.info/).
Audio decoding and output use [mpg123 and out123](https://www.mpg123.de/), installed
separately under their own licenses. The iRadio license covers this repository's
code; it does not grant rights to third-party audio broadcasts.

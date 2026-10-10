# Contributing to iRadio

Bug reports, documentation improvements, accessibility work, and focused pull
requests are welcome. Read the [code of conduct](CODE_OF_CONDUCT.md).

## Get started

Fork the repository, clone your fork, and create a branch for your change.
Python 3.9+ is required. Install mpg123 (including out123) for manual audio tests.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
```

## Make a change

Keep API transport, persistence, audio, input handling, and drawing in their
existing modules. Preserve the default system audio output and configurable ALSA
devices. Do not add a runtime dependency without explaining why it is needed.

Use temporary files and mock network/audio for automated tests. Add regression
coverage when fixing behavior; keep tests independent of live station availability.

```sh
ruff format .
ruff check .
python -m unittest discover -s tests -v
python -m build
python -m twine check dist/*
```

For UI changes, check 48×16, 80×24, and 110×30 terminals. Verify navigation,
scrolling, dialogs, resizing, paused playback, empty results, and network errors.
For audio changes, manually check playback, volume, pause, station switching,
and cleanup. Identify the platform and audio backend used in your PR.

## Open a pull request

Describe the user-visible problem, resulting behavior, and validation. Attach a
terminal screenshot or recording for visual changes. Keep unrelated cleanup in a
separate PR. Do not include your favorites, virtual environment, build output,
stream credentials, or private URLs. Changes are reviewed before merging.

For substantial features, open an issue first to discuss scope. See
[SECURITY.md](SECURITY.md) for vulnerability reports.

## Preparing a release

Update the version in `pyproject.toml` and `src/iradio/__init__.py` together.
Move the relevant changelog entries from Unreleased into the new version, run
CI and the manual audio/UI checks above, and build fresh distributions. Verify
the wheel in a clean virtual environment outside the source directory.

Tagging, GitHub releases, and package-index uploads are maintainer actions.
This repository's CI only builds and validates artifacts; it does not publish
packages. Confirm package-name availability and account access before any
future PyPI release.

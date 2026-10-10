import argparse
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from iradio.ui import Interface
from iradio.view import cell_width, fit


class Screen:
    def __init__(self, height, width):
        self.height, self.width = height, width
        self.writes = []

    def getmaxyx(self):
        return self.height, self.width

    def erase(self):
        self.writes = []

    def refresh(self):
        pass

    def addnstr(self, y, x, text, length, attr):
        if y < 0 or y >= self.height or x < 0 or x + cell_width(text) >= self.width:
            raise AssertionError(f"Out of bounds: {(y, x, text)}")
        self.writes.append((y, x, text))


class ViewTests(unittest.TestCase):
    def test_wide_text_clips_by_cells(self):
        self.assertEqual(fit("日本語 radio", 5), "日本")
        self.assertLessEqual(cell_width(fit("Cafe\u0301", 4)), 4)

    @patch("iradio.ui.curses.has_colors", return_value=False)
    def test_layout_preserves_waveform_and_selection_at_supported_sizes(self, _colors):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(
                favorites_file=Path(directory) / "favorites.json",
                volume=70,
                output=None,
                device=None,
                country=None,
                search=None,
            )
            for height, width in [(16, 48), (22, 80), (24, 80), (30, 110), (40, 160)]:
                with self.subTest(height=height, width=width):
                    screen = Screen(height, width)
                    app = Interface(screen, args)
                    app.stations = [
                        {"name": "日本語 radio", "url": f"https://example.com/{i}"}
                        for i in range(50)
                    ]
                    app.selected = 49
                    app.player.current = app.stations[-1]
                    app.player.state = "playing"
                    app.player.pcm.put((time.monotonic(), [0.1, -0.1] * 512))
                    app.draw()
                    content = "\n".join(text for _, _, text in screen.writes)
                    self.assertIn("ON AIR", content)
                    self.assertTrue(any(0x2800 <= ord(char) <= 0x28FF for char in content))
                    self.assertTrue(any("›" in text for _, _, text in screen.writes))
                    self.assertGreater(app.scroll, 0)

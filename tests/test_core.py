import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from iradio.api import RadioAPI
from iradio.favorites import Favorites
from iradio.player import Player
from iradio.ui import Interface


class FavoritesTests(unittest.TestCase):
    def test_round_trip_and_url_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "favorites.json"
            store = Favorites(path)
            first = {"name": "One", "url": "https://one.example"}
            second = {"name": "Two", "url": "https://two.example"}
            self.assertTrue(store.toggle(first))
            self.assertTrue(store.toggle(second))
            self.assertFalse(store.toggle(first))
            self.assertEqual(Favorites(path).stations, [second])

    def test_invalid_file_preserved_on_load(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "favorites.json"
            path.write_text('{"bad": true}')
            store = Favorites(path)
            self.assertEqual(store.stations, [])
            self.assertTrue(store.warning)
            self.assertEqual(json.loads(path.read_text()), {"bad": True})

    def test_failed_save_does_not_change_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Favorites(Path(directory) / "favorites.json")
            with patch("iradio.favorites.os.replace", side_effect=OSError("read-only")):
                with self.assertRaises(OSError):
                    store.toggle({"url": "https://one.example"})
            self.assertEqual(store.stations, [])
            self.assertEqual(list(Path(directory).iterdir()), [])


class APITests(unittest.TestCase):
    @patch("iradio.api.urlopen")
    def test_failover_filters_unplayable_stations(self, open_url):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            [{"name": "Good", "url": "https://example.com"}, {"name": "Bad"}]
        ).encode()
        open_url.side_effect = [OSError("offline"), response]
        self.assertEqual(len(RadioAPI().search({"name": "jazz"})), 1)
        self.assertEqual(open_url.call_count, 2)


class PlayerTests(unittest.TestCase):
    @patch("iradio.player.subprocess.Popen")
    def test_default_audio_commands_and_cleanup(self, popen):
        audio, process = MagicMock(), MagicMock()
        audio.poll.return_value = process.poll.return_value = None
        process.stdout.read.return_value = b""
        popen.side_effect = [audio, process]
        player = Player()
        player.play({"name": "Test", "url": "https://example.com"})
        self.assertIn("--remote-err", popen.call_args.args[0])
        self.assertEqual(popen.call_args_list[0].args[0][0], "out123")
        player.pause()
        self.assertTrue(player.paused)
        player.change_volume(100)
        self.assertEqual(player.volume, 100)
        player.stop()
        process.terminate.assert_called_once()
        process.stdin.close.assert_called_once()
        self.assertIsNone(player.current)

    def test_remote_playback_feedback(self):
        player = Player()
        player.events.put("@P 2")
        player.events.put("@F 100 0 12.34 0.00")
        player.poll_events()
        self.assertEqual(player.state, "playing")
        self.assertAlmostEqual(player.elapsed, 12.34)
        player.events.put("@P 1")
        player.poll_events()
        self.assertTrue(player.paused)
        player.events.put("@E stream unavailable")
        player.poll_events()
        self.assertEqual(player.state, "error")
        player.stop()
        self.assertEqual(player.elapsed, 0)

    def test_reject_protocol_injection(self):
        with self.assertRaises(ValueError):
            Player().play({"url": "https://example.com\nQUIT"})


class InterfaceTests(unittest.TestCase):
    @patch("iradio.ui.curses.has_colors", return_value=False)
    def test_stale_result_cannot_replace_favorites(self, _colors):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(
                favorites_file=Path(directory) / "favorites.json",
                volume=70,
                output=None,
                device=None,
                country=None,
                search=None,
            )
            app = Interface(MagicMock(), args)
            app.generation = 1
            app.results.put((1, 0, [{"url": "https://old.example"}], None))
            app.handle(ord("b"))
            app.receive()
            self.assertEqual(app.mode, "Favorites")
            self.assertEqual(app.stations, [])

    @patch("iradio.ui.curses.has_colors", return_value=False)
    def test_empty_next_page_keeps_current_results(self, _colors):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(
                favorites_file=Path(directory) / "favorites.json",
                volume=70,
                output=None,
                device=None,
                country=None,
                search=None,
            )
            app = Interface(MagicMock(), args)
            app.stations = [{"name": "Last page", "url": "https://example.com"}]
            app.offset = 50
            app.generation = 2
            app.loading = True
            app.results.put((2, 100, [], None))
            app.receive()
            self.assertEqual(app.offset, 50)
            self.assertEqual(len(app.stations), 1)
            self.assertFalse(app.loading)
            self.assertIn("No more stations", app.status)


if __name__ == "__main__":
    unittest.main()

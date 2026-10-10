import unittest
from array import array

from iradio.waveform import decode_pcm, waveform


class WaveformTests(unittest.TestCase):
    def test_pcm_signed_stereo_downmix(self):
        pcm = array("h", [16384, 16384, -16384, -16384, 32767, -32767])
        self.assertEqual(decode_pcm(pcm.tobytes()), [0.5, -0.5, 0.0])

    def test_silence_has_flat_center_line(self):
        self.assertEqual(waveform([], 8, 3), [" " * 8, "─" * 8, " " * 8])

    def test_positive_and_negative_samples_render_on_opposite_sides(self):
        result = waveform([1.0] * 8 + [-1.0] * 8, 8, 3)
        self.assertTrue(result[0][:4].strip())
        self.assertFalse(result[0][4:].strip())
        self.assertFalse(result[2][:4].strip())
        self.assertTrue(result[2][4:].strip())

    def test_peak_envelope_preserves_transients(self):
        result = waveform([0.0, 1.0, -1.0, 0.0], 1, 3)
        self.assertTrue(all(row.strip() for row in result))

    def test_quiet_audio_reacts_and_gain_does_not_modify_samples(self):
        samples = [0.1] * 8 + [-0.1] * 8
        before = samples.copy()
        result = waveform(samples, 8, 3)
        self.assertTrue(result[0].strip())
        self.assertTrue(result[2].strip())
        self.assertEqual(samples, before)

    def test_background_noise_stays_flat(self):
        self.assertEqual(waveform([0.0001, -0.0001], 4, 3), [" " * 4, "─" * 4, " " * 4])

    def test_small_changes_produce_different_shapes(self):
        self.assertNotEqual(
            waveform([0.05, -0.05] * 40, 10, 3, gain=4), waveform([0.15, -0.15] * 40, 10, 3, gain=4)
        )

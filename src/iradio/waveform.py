"""Render actual signed stereo PCM samples as a terminal waveform."""

from array import array


def decode_pcm(data):
    samples = array("h")
    samples.frombytes(data[: len(data) // 4 * 4])
    return [(samples[i] + samples[i + 1]) / 65536 for i in range(0, len(samples), 2)]


def waveform(samples, width, height=3, gain=None):
    """Signed peak envelope at 2×4 dots per cell; gain affects display only."""
    if width <= 0 or height <= 0:
        return []
    peak = max((abs(value) for value in samples), default=0.0)
    if peak < 0.0005:
        return ["─" * width if row == height // 2 else " " * width for row in range(height)]
    if gain is None:
        gain = min(8.0, max(1.0, 0.85 / peak))
    pixels_high = height * 4
    pixels_wide = width * 2
    cells = [[0 for _ in range(width)] for _ in range(height)]
    # Unicode Braille dot positions for the left and right pixel columns.
    masks = ((1, 2, 4, 64), (8, 16, 32, 128))
    for x in range(pixels_wide):
        start = x * len(samples) // pixels_wide
        end = max(start + 1, (x + 1) * len(samples) // pixels_wide)
        segment = samples[start:end] or [samples[min(start, len(samples) - 1)]]
        low, high = min(segment), max(segment)
        top = round((1 - max(-1.0, min(1.0, high * gain))) * (pixels_high - 1) / 2)
        bottom = round((1 - max(-1.0, min(1.0, low * gain))) * (pixels_high - 1) / 2)
        for y in range(top, bottom + 1):
            cells[y // 4][x // 2] |= masks[x % 2][y % 4]
    return ["".join(chr(0x2800 + dots) if dots else " " for dots in row) for row in cells]

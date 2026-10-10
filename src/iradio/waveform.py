"""Render actual signed stereo PCM samples as a terminal waveform."""

from array import array


def decode_pcm(data):
    samples = array("h")
    samples.frombytes(data[: len(data) // 4 * 4])
    return [(samples[i] + samples[i + 1]) / 65536 for i in range(0, len(samples), 2)]


def waveform(samples, width, height=3):
    if not samples:
        samples = [0.0]
    grid = [[" " for _ in range(width)] for _ in range(height)]
    center = height // 2
    for x in range(width):
        grid[center][x] = "─"
        start = x * len(samples) // width
        end = max(start + 1, (x + 1) * len(samples) // width)
        segment = samples[start:end] or [0.0]
        low, high = min(segment), max(segment)
        top = round((1 - max(-1, min(1, high))) * (height - 1) / 2)
        bottom = round((1 - max(-1, min(1, low))) * (height - 1) / 2)
        for y in range(top, bottom + 1):
            grid[y][x] = "│" if top != bottom else "•"
        if low == high == 0:
            grid[center][x] = "─"
    return ["".join(row) for row in grid]

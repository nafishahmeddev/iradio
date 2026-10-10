"""Time-based terminal animations (decorative, not sampled audio)."""

import math

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


def spinner(seconds):
    return SPINNER[int(seconds * 10) % len(SPINNER)]


def activity(seconds, width=18):
    """An indeterminate progress indicator; never implies a percentage."""
    position = int(seconds * 12) % (2 * max(1, width - 3))
    position = min(position, 2 * max(1, width - 3) - position)
    return "─" * position + "━━━" + "─" * max(0, width - position - 3)


def visualizer(seconds, width=20, active=True):
    if not active:
        return "▁" * width
    levels = "▁▂▃▄▅▆▇█"
    return "".join(
        levels[
            min(
                7,
                int(
                    (math.sin(seconds * 4 + i * 0.7) + math.sin(seconds * 2.7 - i * 0.4) + 2) * 1.9
                ),
            )
        ]
        for i in range(width)
    )


def duration(seconds):
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02}" if hours else f"{minutes:02}:{seconds:02}"

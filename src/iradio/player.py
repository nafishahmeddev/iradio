"""Own the mpg123 process and remote-control protocol."""

import queue
import subprocess
import threading


class Player:
    def __init__(self, volume=70, output=None, device=None):
        self.volume = volume
        self.output = output
        self.device = device
        self.process = None
        self.current = None
        self.paused = False
        self.state = "idle"
        self.elapsed = 0.0
        self.events = queue.Queue()

    def command(self, value):
        if self.process and self.process.poll() is None and self.process.stdin:
            self.process.stdin.write(value + "\n")
            self.process.stdin.flush()

    def play(self, station):
        url = station.get("url_resolved") or station.get("url")
        if not isinstance(url, str) or "\n" in url or "\r" in url:
            raise ValueError("Invalid stream URL")
        self.stop()
        args = ["mpg123", "-R"]
        if self.output:
            args.extend(["-o", self.output])
        if self.device:
            args.extend(["-a", self.device])
        self.process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        process = self.process
        self.events = queue.Queue()
        events = self.events

        def read_events():
            try:
                for line in process.stdout:
                    events.put(line.strip())
            except (OSError, ValueError):
                pass

        threading.Thread(target=read_events, daemon=True).start()
        self.state = "connecting"
        try:
            self.command(f"VOLUME {self.volume}")
            self.command(f"LOAD {url}")
        except OSError:
            self.stop()
            raise
        self.current = station

    def poll_events(self):
        """Read mpg123 playback status and its decoded elapsed time."""
        while True:
            try:
                line = self.events.get_nowait()
            except queue.Empty:
                return
            if line.startswith("@P "):
                state = line.split()[1]
                self.state = {"0": "stopped", "1": "paused", "2": "playing"}.get(state, self.state)
                self.paused = self.state == "paused"
            elif line.startswith("@F "):
                try:
                    self.elapsed = float(line.split()[3])
                except (ValueError, IndexError):
                    pass
            elif line.startswith("@E"):
                self.state = "error"

    def pause(self):
        if self.process and self.process.poll() is None:
            self.command("PAUSE")
            self.paused = not self.paused

    def change_volume(self, amount):
        self.volume = max(0, min(100, self.volume + amount))
        self.command(f"VOLUME {self.volume}")

    def stop(self):
        process, self.process = self.process, None
        self.current = None
        self.paused = False
        self.state = "idle"
        self.elapsed = 0.0
        self.events = queue.Queue()
        if process:
            try:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            finally:
                if process.stdin:
                    process.stdin.close()
                if process.stdout:
                    process.stdout.close()

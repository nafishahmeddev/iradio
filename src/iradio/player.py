"""Own the mpg123 process and remote-control protocol."""

import queue
import subprocess
import threading
import time

from .waveform import decode_pcm


class Player:
    def __init__(self, volume=70, output=None, device=None, gain_db=0.0):
        self.volume = volume
        self.gain_db = gain_db
        self.output = output
        self.device = device
        self.process = None
        self.audio_process = None
        self.pcm = queue.Queue(maxsize=1)
        self.samples = []
        self.sample_time = 0.0
        self.current = None
        self.paused = False
        self.state = "idle"
        self.elapsed = 0.0
        self.events = queue.Queue()

    def command(self, value):
        if self.process and self.process.poll() is None and self.process.stdin:
            self.process.stdin.write((value + "\n").encode())
            self.process.stdin.flush()

    def play(self, station):
        url = station.get("url_resolved") or station.get("url")
        if not isinstance(url, str) or "\n" in url or "\r" in url:
            raise ValueError("Invalid stream URL")
        self.stop()
        audio_args = ["out123", "-q", "-r", "44100", "-c", "2", "-e", "s16"]
        if self.gain_db:
            audio_args.extend(["-P", str(self.gain_db), "--clip", "soft"])
        if self.output:
            audio_args.extend(["-o", self.output])
        if self.device:
            audio_args.extend(["-a", self.device])
        try:
            self.audio_process = subprocess.Popen(
                audio_args,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
            self.process = subprocess.Popen(
                ["mpg123", "-R", "--remote-err", "-s", "-r", "44100", "--stereo", "-e", "s16"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
        except OSError:
            self.stop()
            raise
        process, audio = self.process, self.audio_process
        self.events = queue.Queue()
        events, pcm = self.events, self.pcm

        def read_events():
            try:
                for line in process.stderr:
                    events.put(line.decode("utf-8", errors="replace").strip())
            except (OSError, ValueError):
                pass

        def forward_pcm():
            pending = b""
            try:
                while True:
                    chunk = process.stdout.read(4096)
                    if not chunk:
                        break
                    pending += chunk
                    length = len(pending) // 4 * 4
                    if not length:
                        continue
                    chunk, pending = pending[:length], pending[length:]
                    view = memoryview(chunk)
                    while view:
                        written = audio.stdin.write(view)
                        if not written:
                            raise OSError("Audio output disconnected")
                        view = view[written:]
                    if pcm.full():
                        try:
                            pcm.get_nowait()
                        except queue.Empty:
                            pass
                    pcm.put_nowait((time.monotonic(), decode_pcm(chunk)))
            except (OSError, ValueError):
                events.put("@E Audio output disconnected")

        threading.Thread(target=read_events, daemon=True).start()
        threading.Thread(target=forward_pcm, daemon=True).start()
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
        try:
            self.sample_time, self.samples = self.pcm.get_nowait()
        except queue.Empty:
            pass
        if self.paused or time.monotonic() - self.sample_time > 0.4:
            self.samples = []
        if self.audio_process and self.audio_process.poll() is not None:
            self.state = "error"
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
        audio, self.audio_process = self.audio_process, None
        self.pcm = queue.Queue(maxsize=1)
        self.samples = []
        self.sample_time = 0.0
        for child in (audio, process):
            if not child:
                continue
            try:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
            finally:
                for pipe in (child.stdin, child.stdout, child.stderr):
                    if pipe:
                        pipe.close()

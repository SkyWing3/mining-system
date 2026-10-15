"""Grabación de voz: INMP441 por I2S mediante ALSA (`arecord`) o señal sintética en el simulador."""
from __future__ import annotations

import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import Protocol

from . import wav

MIN_SECONDS = 0.5


class RecorderError(Exception):
    pass


@dataclass(frozen=True)
class Recording:
    wav: bytes
    duration_ms: int


class Recorder(Protocol):
    @property
    def recording(self) -> bool: ...
    @property
    def elapsed(self) -> float: ...
    def start(self) -> None: ...
    def stop(self) -> Recording: ...
    def cancel(self) -> None: ...


class ArecordRecorder:
    """Streams raw S16_LE mono samples from `arecord`; the plug device converts the I2S format."""

    def __init__(self, device: str, sample_rate: int, max_seconds: int, popen=subprocess.Popen, clock=time.monotonic):
        self.device = device
        self.sample_rate = sample_rate
        self.max_bytes = max_seconds * sample_rate * 2
        self._popen = popen
        self._clock = clock
        self._process = None
        self._errors = None
        self._reader: threading.Thread | None = None
        self._buffer = bytearray()
        self._started = 0.0

    @property
    def recording(self) -> bool:
        return self._process is not None

    @property
    def elapsed(self) -> float:
        return self._clock() - self._started if self.recording else 0.0

    def start(self) -> None:
        if self.recording:
            raise RecorderError("Ya hay una grabación en curso")
        command = ["arecord", "-q", "-D", self.device, "-c", "1", "-r", str(self.sample_rate), "-f", "S16_LE", "-t", "raw"]
        # ALSA warnings go to a file: a full stderr pipe would stall the recording.
        self._errors = tempfile.TemporaryFile()
        try:
            self._process = self._popen(command, stdout=subprocess.PIPE, stderr=self._errors)
        except OSError as error:
            self._errors.close()
            raise RecorderError("No se encontró arecord; instala alsa-utils") from error
        self._buffer = bytearray()
        self._started = self._clock()
        self._reader = threading.Thread(target=self._read, name="mining-recorder", daemon=True)
        self._reader.start()

    def stop(self) -> Recording:
        detail = self._finish()
        samples = wav.from_pcm_bytes(bytes(self._buffer))
        if len(samples) < MIN_SECONDS * self.sample_rate:
            raise RecorderError(detail or "La grabación es demasiado corta")
        audio = wav.encode(wav.normalize(samples), self.sample_rate)
        return Recording(audio, len(samples) * 1000 // self.sample_rate)

    def cancel(self) -> None:
        if self.recording:
            self._finish()
        self._buffer = bytearray()

    def _finish(self) -> str:
        """Stop arecord and return its error output, if any."""
        process, self._process = self._process, None
        if process is None:
            raise RecorderError("No hay una grabación en curso")
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        if self._reader:
            self._reader.join(timeout=3)
        if process.stdout:
            process.stdout.close()
        detail = ""
        if self._errors is not None:
            self._errors.seek(0)
            detail = self._errors.read(1024).decode(errors="replace").strip()
            self._errors.close()
            self._errors = None
        return detail

    def _read(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        while len(self._buffer) < self.max_bytes:
            chunk = process.stdout.read(4096)
            if not chunk:
                break
            self._buffer.extend(chunk[: self.max_bytes - len(self._buffer)])


class SimulatedRecorder:
    """Generates a synthetic tone with the recorded duration; no microphone is used."""

    def __init__(self, sample_rate: int, max_seconds: int, clock=time.monotonic):
        self.sample_rate = sample_rate
        self.max_seconds = max_seconds
        self._clock = clock
        self._started: float | None = None

    @property
    def recording(self) -> bool:
        return self._started is not None

    @property
    def elapsed(self) -> float:
        return self._clock() - self._started if self._started is not None else 0.0

    def start(self) -> None:
        if self.recording:
            raise RecorderError("Ya hay una grabación en curso")
        self._started = self._clock()

    def stop(self) -> Recording:
        if self._started is None:
            raise RecorderError("No hay una grabación en curso")
        seconds = min(self.max_seconds, max(MIN_SECONDS, self.elapsed))
        self._started = None
        samples = wav.synthetic_voice(seconds, self.sample_rate)
        return Recording(wav.encode(samples, self.sample_rate), len(samples) * 1000 // self.sample_rate)

    def cancel(self) -> None:
        self._started = None

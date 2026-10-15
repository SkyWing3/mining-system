"""Procesamiento de audio PCM de 16 bits sin dependencias externas."""
from __future__ import annotations

import io
import math
import sys
import wave
from array import array

FULL_SCALE = 32767


def from_pcm_bytes(data: bytes) -> array:
    """Little-endian signed 16-bit samples, as produced by `arecord -f S16_LE`."""
    samples = array("h")
    samples.frombytes(data[: len(data) - len(data) % 2])
    if sys.byteorder == "big":
        samples.byteswap()
    return samples


def normalize(samples: array, target_peak: float = 0.89, max_gain: float = 8.0) -> array:
    """The INMP441 records quietly; raise the level up to `target_peak` without clipping."""
    peak = max((abs(sample) for sample in samples), default=0)
    if peak == 0:
        return array("h", samples)
    gain = min(max_gain, target_peak * FULL_SCALE / peak)
    if gain <= 1:
        return array("h", samples)
    return array("h", (max(-FULL_SCALE, min(FULL_SCALE, round(sample * gain))) for sample in samples))


def encode(samples: array, sample_rate: int) -> bytes:
    data = array("h", samples)
    if sys.byteorder == "big":
        data.byteswap()
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(data.tobytes())
    return output.getvalue()


def synthetic_voice(seconds: float, sample_rate: int) -> array:
    """Clearly synthetic test signal used by the simulator instead of a microphone."""
    count = max(1, int(seconds * sample_rate))
    return array("h", (
        round(0.4 * FULL_SCALE * math.sin(2 * math.pi * 440 * index / sample_rate) * (0.5 + 0.5 * math.sin(2 * math.pi * 3 * index / sample_rate)))
        for index in range(count)
    ))

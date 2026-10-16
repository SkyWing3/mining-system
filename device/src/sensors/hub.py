"""Muestreo periódico en un hilo propio.

Cada muestra se clasifica y se publica al hilo principal; el cliente de red
lee la última muestra para transmitirla como telemetría en vivo.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable

from ..alerts.levels import Assessment, ThresholdEvaluator
from .readings import SensorSnapshot
from .sources import SensorSource

log = logging.getLogger(__name__)

# Transport limits accepted by the central (docs/api.md); out-of-range values are dropped.
LIMITS = {
    "temperatureC": (-50.0, 150.0),
    "objectTemperatureC": (-70.0, 380.0),
    "gasPpm": (0.0, 1_000_000.0),
    "gasVoltage": (0.0, 5.5),
}


@dataclass(frozen=True)
class MonitorUpdate:
    snapshot: SensorSnapshot
    assessment: Assessment
    sampled_at: float


class SensorHub:
    def __init__(self, source: SensorSource, evaluator: ThresholdEvaluator, interval: float,
                 publish: Callable[[MonitorUpdate], None], clock=time.monotonic):
        self.source = source
        self.evaluator = evaluator
        self.interval = interval
        self._publish = publish
        self._clock = clock
        self._lock = threading.Lock()
        self._latest: MonitorUpdate | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def latest(self) -> MonitorUpdate | None:
        with self._lock:
            return self._latest

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("El muestreo ya está iniciado")
        self._thread = threading.Thread(target=self._run, name="mining-sensors", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        self.source.close()

    def sample_once(self) -> MonitorUpdate:
        snapshot = self.source.sample()
        update = MonitorUpdate(snapshot, self.evaluator.update(snapshot), self._clock())
        with self._lock:
            self._latest = update
        self._publish(update)
        return update

    def telemetry(self) -> dict | None:
        """Latest sample as a telemetry frame body, or None when there is nothing recent to send."""
        update = self.latest
        if update is None or self._clock() - update.sampled_at > max(3 * self.interval, 5):
            return None
        return telemetry_fields(update)

    def _run(self) -> None:
        next_sample = self._clock()
        while not self._stop.is_set():
            try:
                self.sample_once()
            except Exception:
                # A sensor fault must never stop the device; it is reported on the OLED.
                log.exception("No se pudo muestrear los sensores")
            next_sample += self.interval
            self._stop.wait(max(0.0, next_sample - self._clock()))


def telemetry_fields(update: MonitorUpdate) -> dict | None:
    snapshot = update.snapshot
    fields = {
        "temperatureC": snapshot.ambient_c,
        "objectTemperatureC": snapshot.object_c,
        "gasPpm": snapshot.co_ppm,
        "gasVoltage": snapshot.co_volts,
    }
    measurements = {
        name: round(value, 4)
        for name, value in fields.items()
        if value is not None and LIMITS[name][0] <= value <= LIMITS[name][1]
    }
    if not measurements:
        return None
    return {**measurements, "level": update.assessment.level, "simulated": snapshot.simulated}

"""Instantánea de los sensores, independiente del hardware que la produjo."""
from __future__ import annotations

from dataclasses import dataclass

# CO sensor states shown on the OLED and used to decide what is transmitted.
CO_DISABLED = "disabled"
CO_ERROR = "error"
CO_WARMING = "warming"
CO_UNCALIBRATED = "uncalibrated"
CO_OK = "ok"

THERMOMETER_DISABLED = "disabled"
THERMOMETER_ERROR = "error"
THERMOMETER_OK = "ok"


@dataclass(frozen=True)
class SensorSnapshot:
    ambient_c: float | None = None
    object_c: float | None = None
    co_volts: float | None = None
    co_ppm: float | None = None
    co_state: str = CO_DISABLED
    thermometer_state: str = THERMOMETER_DISABLED
    warmup_remaining: int = 0
    simulated: bool = False

    @property
    def has_measurements(self) -> bool:
        return any(value is not None for value in (self.ambient_c, self.object_c, self.co_volts, self.co_ppm))

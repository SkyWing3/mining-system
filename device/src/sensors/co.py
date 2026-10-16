"""SEN0564 (CO) leído en A0 del ADS1115.

El fabricante lo define como sensor cualitativo: solo se informan ppm con una
calibración configurada y después del precalentamiento.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

from ..config import CoConfig
from .ads1115 import Ads1115
from .readings import CO_OK, CO_UNCALIBRATED, CO_WARMING


@dataclass(frozen=True)
class CoReading:
    volts: float
    ppm: float | None
    state: str
    warmup_remaining: int


class CoSensor:
    def __init__(self, adc: Ads1115, config: CoConfig, clock=time.monotonic):
        self.adc = adc
        self.config = config
        self._clock = clock
        self._started = clock()

    def warmup_remaining(self) -> int:
        return max(0, round(self.config.warmup_seconds - (self._clock() - self._started)))

    def read(self) -> CoReading:
        # Small negative offsets near 0 V are noise, never a concentration.
        volts = max(0.0, self.adc.read_volts(self.config.channel, self.config.samples))
        remaining = self.warmup_remaining()
        if remaining > 0:
            return CoReading(volts, None, CO_WARMING, remaining)
        if self.config.calibration is None:
            return CoReading(volts, None, CO_UNCALIBRATED, 0)
        return CoReading(volts, self.config.calibration.ppm(volts), CO_OK, 0)

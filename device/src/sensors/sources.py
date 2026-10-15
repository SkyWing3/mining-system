"""Fuentes de lecturas: sensores físicos por I2C o simulación explícita."""
from __future__ import annotations

import logging
import random
import threading
import time
from typing import Protocol

from ..config import SensorsConfig
from .ads1115 import Ads1115
from .co import CoSensor
from .mlx90614 import Mlx90614
from .readings import (CO_DISABLED, CO_ERROR, CO_OK, THERMOMETER_DISABLED, THERMOMETER_ERROR, THERMOMETER_OK,
                       SensorSnapshot)

log = logging.getLogger(__name__)


class SensorSource(Protocol):
    def sample(self) -> SensorSnapshot: ...
    def close(self) -> None: ...


class HardwareSensors:
    """SEN0564 through the ADS1115 and MLX90614 on the shared I2C bus."""

    def __init__(self, config: SensorsConfig, bus=None):
        if bus is None and (config.co.enabled or config.mlx90614.enabled):
            from smbus2 import SMBus
            bus = SMBus(config.i2c_port)
        self.bus = bus
        self.co = CoSensor(Ads1115(bus, config.ads1115_address), config.co) if config.co.enabled else None
        self.thermometer = Mlx90614(bus, config.mlx90614.address) if config.mlx90614.enabled else None
        self._errors: dict[str, str] = {}

    def sample(self) -> SensorSnapshot:
        values: dict = {"co_state": CO_DISABLED, "thermometer_state": THERMOMETER_DISABLED}
        if self.co is not None:
            try:
                reading = self.co.read()
                values.update(co_volts=reading.volts, co_ppm=reading.ppm, co_state=reading.state, warmup_remaining=reading.warmup_remaining)
                self._recovered("co")
            except OSError as error:
                values["co_state"] = CO_ERROR
                self._failed("co", error)
        if self.thermometer is not None:
            try:
                values.update(ambient_c=self.thermometer.ambient_celsius(), object_c=self.thermometer.object_celsius(),
                              thermometer_state=THERMOMETER_OK)
                self._recovered("thermometer")
            except OSError as error:
                values["thermometer_state"] = THERMOMETER_ERROR
                self._failed("thermometer", error)
        return SensorSnapshot(**values)

    def close(self) -> None:
        if self.bus is not None and hasattr(self.bus, "close"):
            self.bus.close()

    # Log each failure once, and its recovery, instead of every second.
    def _failed(self, name: str, error: OSError) -> None:
        if self._errors.get(name) != str(error):
            self._errors[name] = str(error)
            log.warning("Sensor %s sin lectura: %s", name, error)

    def _recovered(self, name: str) -> None:
        if self._errors.pop(name, None) is not None:
            log.info("Sensor %s recuperado", name)


class SimulatedSensors:
    """Lecturas sintéticas marcadas como simuladas; permite forzar picos para demostraciones."""

    BASE_AMBIENT, BASE_OBJECT, BASE_PPM = 24.0, 26.5, 6.0
    SPIKE_AMBIENT, SPIKE_PPM = 41.0, 260.0
    VOLTS_PER_PPM = 0.0015
    BASELINE_VOLTS = 0.12

    def __init__(self, seed: int | None = None, clock=time.monotonic):
        self._random = random.Random(seed)
        self._clock = clock
        self._lock = threading.Lock()
        self._gas_until = 0.0
        self._heat_until = 0.0
        self.ambient, self.object, self.ppm = self.BASE_AMBIENT, self.BASE_OBJECT, self.BASE_PPM

    def spike_gas(self, seconds: float = 25) -> None:
        with self._lock:
            self._gas_until = self._clock() + seconds

    def spike_heat(self, seconds: float = 25) -> None:
        with self._lock:
            self._heat_until = self._clock() + seconds

    def sample(self) -> SensorSnapshot:
        with self._lock:
            now = self._clock()
            ppm_target = self.SPIKE_PPM if now < self._gas_until else self.BASE_PPM
            ambient_target = self.SPIKE_AMBIENT if now < self._heat_until else self.BASE_AMBIENT
            # Move towards the target with some noise, as a real sensor would drift.
            self.ppm = max(0.0, self.ppm + (ppm_target - self.ppm) * 0.35 + self._random.gauss(0, 1.2))
            self.ambient += (ambient_target - self.ambient) * 0.3 + self._random.gauss(0, 0.08)
            self.object += (ambient_target + 2.5 - self.object) * 0.3 + self._random.gauss(0, 0.15)
            return SensorSnapshot(
                ambient_c=round(self.ambient, 2),
                object_c=round(self.object, 2),
                co_volts=round(self.BASELINE_VOLTS + self.ppm * self.VOLTS_PER_PPM, 4),
                co_ppm=round(self.ppm, 1),
                co_state=CO_OK,
                thermometer_state=THERMOMETER_OK,
                simulated=True,
            )

    def close(self) -> None:
        pass

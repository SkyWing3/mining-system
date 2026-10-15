"""Conversor ADS1115 por I2C (dirección 0x48 con ADDR a GND)."""
from __future__ import annotations

import time
from typing import Protocol

CONVERSION_REGISTER = 0x00
CONFIG_REGISTER = 0x01
# Programmable gain: full-scale volts → PGA bits.
GAINS = {6.144: 0b000, 4.096: 0b001, 2.048: 0b010, 1.024: 0b011, 0.512: 0b100, 0.256: 0b101}
START_SINGLE_SHOT = 0x8000
SINGLE_SHOT_MODE = 0x0100
RATE_128_SPS = 0b100 << 5
COMPARATOR_DISABLED = 0b11


class I2cBus(Protocol):
    def write_i2c_block_data(self, address: int, register: int, data: list[int]) -> None: ...
    def read_i2c_block_data(self, address: int, register: int, length: int) -> list[int]: ...


class Ads1115:
    def __init__(self, bus: I2cBus, address: int = 0x48, full_scale: float = 4.096, sleep=time.sleep):
        if full_scale not in GAINS:
            raise ValueError(f"Rango del ADS1115 no admitido: {full_scale} V")
        self.bus = bus
        self.address = address
        self.full_scale = full_scale
        self._sleep = sleep

    def config_word(self, channel: int) -> int:
        """Single-ended input AINx against GND, single shot, 128 SPS, comparator off."""
        if channel not in range(4):
            raise ValueError("Canal del ADS1115 entre 0 y 3")
        multiplexer = 0b100 + channel
        return START_SINGLE_SHOT | multiplexer << 12 | GAINS[self.full_scale] << 9 | SINGLE_SHOT_MODE | RATE_128_SPS | COMPARATOR_DISABLED

    def read_volts(self, channel: int, samples: int = 1) -> float:
        return sum(self._read_once(channel) for _ in range(samples)) / samples

    def _read_once(self, channel: int) -> float:
        config = self.config_word(channel)
        self.bus.write_i2c_block_data(self.address, CONFIG_REGISTER, [config >> 8, config & 0xFF])
        # One conversion at 128 SPS takes 7.8 ms; the OS bit returns to 1 when it is ready.
        for _ in range(10):
            self._sleep(0.008)
            status = self.bus.read_i2c_block_data(self.address, CONFIG_REGISTER, 2)
            if status[0] & 0x80:
                break
        else:
            raise OSError("El ADS1115 no completó la conversión")
        high, low = self.bus.read_i2c_block_data(self.address, CONVERSION_REGISTER, 2)
        raw = int.from_bytes(bytes((high, low)), "big", signed=True)
        return raw * self.full_scale / 32768

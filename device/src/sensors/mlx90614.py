"""Termómetro infrarrojo MLX90614 por SMBus (dirección 0x5A)."""
from __future__ import annotations

from typing import Protocol

AMBIENT_REGISTER = 0x06
OBJECT_REGISTER = 0x07
ERROR_FLAG = 0x8000


class SmBus(Protocol):
    def read_word_data(self, address: int, register: int) -> int: ...


class Mlx90614:
    def __init__(self, bus: SmBus, address: int = 0x5A):
        self.bus = bus
        self.address = address

    def ambient_celsius(self) -> float:
        return self._read(AMBIENT_REGISTER)

    def object_celsius(self) -> float:
        return self._read(OBJECT_REGISTER)

    def _read(self, register: int) -> float:
        raw = self.bus.read_word_data(self.address, register)
        if raw & ERROR_FLAG:
            raise OSError("El MLX90614 informó un error de lectura")
        # 0.02 K per bit.
        return raw * 0.02 - 273.15

"""Salidas físicas de alerta: LED RGB, buzzer activo y motor vibrador."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Protocol

from ..config import AlertsConfig

COLORS = {
    "off": (0, 0, 0),
    "green": (0, 1, 0),
    "yellow": (1, 1, 0),
    "red": (1, 0, 0),
    "blue": (0, 0, 1),
}


class AlertOutputs(Protocol):
    def set_led(self, color: str, blink: bool = False) -> None: ...
    def buzz(self, on_time: float, off_time: float, count: int | None) -> None: ...
    def stop_buzzer(self) -> None: ...
    def vibrate(self, on_time: float, off_time: float, count: int | None) -> None: ...
    def stop_motor(self) -> None: ...
    def close(self) -> None: ...


class GpioOutputs:
    """gpiozero runs blink/beep patterns in background threads; count None repeats until stopped."""

    def __init__(self, config: AlertsConfig):
        from gpiozero import Buzzer, DigitalOutputDevice, RGBLED
        self._devices = []
        try:
            self.led = self._own(RGBLED(config.led_red, config.led_green, config.led_blue,
                                        active_high=config.led_active_high, pwm=False))
            self.buzzer = self._own(Buzzer(config.buzzer_pin, active_high=config.buzzer_active_high, initial_value=False))
            # The NPN stage switches the motor on with a high level.
            self.motor = self._own(DigitalOutputDevice(config.motor_pin, active_high=True, initial_value=False))
        except Exception:
            self.close()
            raise

    def _own(self, device):
        self._devices.append(device)
        return device

    def set_led(self, color: str, blink: bool = False) -> None:
        rgb = COLORS[color]
        if blink:
            self.led.blink(on_time=0.5, off_time=0.5, on_color=rgb, off_color=COLORS["off"], background=True)
        else:
            self.led.color = rgb

    def buzz(self, on_time: float, off_time: float, count: int | None) -> None:
        self.buzzer.beep(on_time=on_time, off_time=off_time, n=count, background=True)

    def stop_buzzer(self) -> None:
        self.buzzer.off()

    def vibrate(self, on_time: float, off_time: float, count: int | None) -> None:
        self.motor.blink(on_time=on_time, off_time=off_time, n=count, background=True)

    def stop_motor(self) -> None:
        self.motor.off()

    def close(self) -> None:
        for device in reversed(self._devices):
            device.close()
        self._devices.clear()


@dataclass(frozen=True)
class Pattern:
    on_time: float
    off_time: float
    count: int | None
    started: float

    def active(self, now: float) -> bool:
        """Whether the output is energized at `now` (used to draw the simulator)."""
        period = self.on_time + self.off_time
        elapsed = now - self.started
        if elapsed < 0 or (self.count is not None and elapsed >= self.count * period):
            return False
        return period == 0 or elapsed % period < self.on_time


class SimulatedOutputs:
    """Records the requested state so the simulator window and the tests can show it."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self.led_color = "off"
        self.led_blink = False
        self.buzzer: Pattern | None = None
        self.motor: Pattern | None = None
        self.history: list[tuple[str, tuple]] = []

    def set_led(self, color: str, blink: bool = False) -> None:
        with self._lock:
            self.led_color, self.led_blink = color, blink
            self.history.append(("led", (color, blink)))

    def buzz(self, on_time: float, off_time: float, count: int | None) -> None:
        with self._lock:
            self.buzzer = Pattern(on_time, off_time, count, self._clock())
            self.history.append(("buzz", (on_time, off_time, count)))

    def stop_buzzer(self) -> None:
        with self._lock:
            self.buzzer = None
            self.history.append(("buzz", ()))

    def vibrate(self, on_time: float, off_time: float, count: int | None) -> None:
        with self._lock:
            self.motor = Pattern(on_time, off_time, count, self._clock())
            self.history.append(("vibrate", (on_time, off_time, count)))

    def stop_motor(self) -> None:
        with self._lock:
            self.motor = None
            self.history.append(("vibrate", ()))

    def led_lit(self) -> bool:
        return self.led_color != "off" and (not self.led_blink or int(self._clock() * 2) % 2 == 0)

    def buzzer_on(self) -> bool:
        pattern = self.buzzer
        return pattern is not None and pattern.active(self._clock())

    def motor_on(self) -> bool:
        pattern = self.motor
        return pattern is not None and pattern.active(self._clock())

    def close(self) -> None:
        self.set_led("off")
        self.stop_buzzer()
        self.stop_motor()

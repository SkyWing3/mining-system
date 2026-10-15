"""Reglas de aviso de la manilla (componentes.tex).

LED: verde normal, amarillo precaución, rojo peligro, azul aviso de la central
o sin enlace. Motor: vibración larga en peligro, doble al recibir un aviso y
corta al pulsar un botón. Buzzer: intermitente en peligro; Enter lo silencia
durante `silence_seconds`.
"""
from __future__ import annotations

import time

from .levels import CAUTION, DANGER, NORMAL
from .outputs import AlertOutputs

DANGER_BUZZ = (0.4, 0.4, None)
DANGER_VIBRATION = (1.5, 3.5, None)
CAUTION_BUZZ = (0.15, 0.0, 1)
NOTICE_VIBRATION = (0.25, 0.2, 2)
CRITICAL_NOTICE_BUZZ = (0.2, 0.2, 3)
NOTICE_BUZZ = (0.1, 0.0, 1)
BUTTON_VIBRATION = (0.06, 0.0, 1)


class AlertController:
    def __init__(self, outputs: AlertOutputs, silence_seconds: float, button_feedback: bool = True,
                 monitor_link: bool = True, clock=time.monotonic):
        self.outputs = outputs
        self.silence_seconds = silence_seconds
        self.button_feedback = button_feedback
        # Without a configured central there is no link to report as lost.
        self.monitor_link = monitor_link
        self._clock = clock
        self.level = NORMAL
        self.connected = False
        self.notice: str | None = None
        self.silenced_until = 0.0
        self._alarm_running = False
        self._led: tuple[str, bool] | None = None
        self._apply_led()

    @property
    def silenced(self) -> bool:
        return self._clock() < self.silenced_until

    def on_level(self, level: str) -> None:
        if level == self.level:
            return
        previous, self.level = self.level, level
        if level == DANGER:
            self.silenced_until = 0.0
            self._start_alarm()
        else:
            self._stop_alarm()
            if level == CAUTION and previous == NORMAL:
                self.outputs.buzz(*CAUTION_BUZZ)
        self._apply_led()

    def on_connection(self, connected: bool) -> None:
        self.connected = connected
        self._apply_led()

    def on_notice(self, severity: str) -> None:
        self.notice = severity
        if not self._alarm_running:
            self.outputs.vibrate(*NOTICE_VIBRATION)
            self.outputs.buzz(*(CRITICAL_NOTICE_BUZZ if severity == "critical" else NOTICE_BUZZ))
        self._apply_led()

    def on_notice_cleared(self) -> None:
        self.notice = None
        self._apply_led()

    def silence(self) -> None:
        if self.level != DANGER:
            return
        self.silenced_until = self._clock() + self.silence_seconds
        self._stop_alarm()

    def on_button(self) -> None:
        if self.button_feedback and not self._alarm_running:
            self.outputs.vibrate(*BUTTON_VIBRATION)

    def tick(self) -> None:
        """Resume the alarm when the silence period ends and the danger persists."""
        if self.level == DANGER and not self._alarm_running and not self.silenced:
            self._start_alarm()

    def close(self) -> None:
        self._stop_alarm()
        self.outputs.set_led("off")

    def _start_alarm(self) -> None:
        self.outputs.buzz(*DANGER_BUZZ)
        self.outputs.vibrate(*DANGER_VIBRATION)
        self._alarm_running = True

    def _stop_alarm(self) -> None:
        if self._alarm_running:
            self.outputs.stop_buzzer()
            self.outputs.stop_motor()
            self._alarm_running = False

    def _apply_led(self) -> None:
        if self.level == DANGER:
            state = ("red", True)
        elif self.notice is not None:
            state = ("blue", True)
        elif self.level == CAUTION:
            state = ("yellow", False)
        elif self.monitor_link and not self.connected:
            state = ("blue", False)
        else:
            state = ("green", False)
        # Re-sending the same blink pattern would restart it and make the LED flicker.
        if state != self._led:
            self._led = state
            self.outputs.set_led(*state)

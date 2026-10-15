"""Pulsadores con pull-up interno. Los callbacks solo encolan acciones; el hilo principal dibuja."""
from __future__ import annotations

from contextlib import ExitStack
from queue import Queue

from ..config import ButtonsConfig
from ..events import Action


class Buttons:
    def __init__(self, config: ButtonsConfig, queue: Queue):
        from gpiozero import Button
        self.resources = ExitStack()
        try:
            for pin, action in ((config.up, Action.UP), (config.down, Action.DOWN), (config.enter, Action.ENTER)):
                button = Button(pin, pull_up=True, bounce_time=config.bounce_seconds)
                self.resources.callback(button.close)
                button.when_pressed = lambda event=action: queue.put(event)
        except Exception:
            self.close()
            raise

    def close(self) -> None:
        self.resources.close()

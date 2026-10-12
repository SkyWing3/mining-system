"""Los callbacks solo encolan acciones; el hilo principal dibuja."""
from contextlib import ExitStack
from ..display.menu import Action


class Buttons:
    def __init__(self, config, queue):
        from gpiozero import Button
        self.resources = ExitStack()
        try:
            for name, action in (("up", Action.UP), ("down", Action.DOWN), ("enter", Action.ENTER)):
                button = Button(config[name], pull_up=True, bounce_time=config["bounce_seconds"])
                self.resources.callback(button.close)
                button.when_pressed = lambda event=action: queue.put(event)
        except Exception:
            self.close()
            raise

    def close(self):
        self.resources.close()

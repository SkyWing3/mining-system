"""Estado de navegación; no accede a sensores ni GPIO."""
from dataclasses import dataclass
from enum import Enum
from sqlite3 import Error as StorageError
from ..communication.catalog import MESSAGES


class Action(Enum):
    UP = "up"
    DOWN = "down"
    ENTER = "enter"


@dataclass(frozen=True)
class Page:
    title: str
    lines: tuple[str, ...]


PAGES = (
    Page("Estado", ("Sensores: pendiente", "Central: sin enlace")),
    Page("Gases", ("Sensor CO SEN0564", "Lectura: sin datos")),
    Page("Temperatura", ("Sensor MLX90614", "Lectura: sin datos")),
    Page("Mensajes", ("Reportes a central", "Selecciona mensaje")),
    Page("Ajustes", ("Arriba / abajo", "Enter: seleccionar")),
)


class Menu:
    visible_rows = 3

    def __init__(self, sender=None):
        self.selected = 0
        self.offset = 0
        self.page = None
        self.sender = sender
        self.message_mode = None
        self.message_selected = 0
        self.message_offset = 0
        self.confirm_selected = 0
        self.pending_id = None
        self.delivery_status = ""
        self.connected = False

    def transport(self, event):
        if event.kind == "connected":
            self.connected = True
        elif event.kind == "disconnected":
            self.connected = False
        elif event.kind == "delivered" and event.message_id == self.pending_id:
            self.delivery_status = "Enviado a central"

    def _messages(self, action):
        if self.message_mode == "result":
            if action == Action.ENTER:
                self.message_mode = "choose"
            return
        if self.message_mode == "confirm":
            if action in (Action.UP, Action.DOWN):
                self.confirm_selected = 1 - self.confirm_selected
            elif action == Action.ENTER:
                if self.confirm_selected == 1:
                    self.message_mode = "choose"
                    return
                try:
                    if self.sender is None:
                        self.delivery_status = "Sin configurar"
                    else:
                        self.pending_id = self.sender(MESSAGES[self.message_selected][0])
                        self.delivery_status = "Guardado en cola"
                except (OSError, ValueError, StorageError):
                    self.delivery_status = "Error al guardar"
                self.message_mode = "result"
            return
        if action == Action.ENTER:
            if self.message_selected == len(MESSAGES):
                self.page = None
                self.message_mode = None
            else:
                self.confirm_selected = 0
                self.message_mode = "confirm"
            return
        step = -1 if action == Action.UP else 1
        self.message_selected = (self.message_selected + step) % (len(MESSAGES) + 1)
        if self.message_selected < self.message_offset:
            self.message_offset = self.message_selected
        elif self.message_selected >= self.message_offset + self.visible_rows:
            self.message_offset = self.message_selected - self.visible_rows + 1

    def handle(self, action: Action):
        if self.message_mode is not None:
            self._messages(action)
            return
        if self.page is not None:
            if action == Action.ENTER:
                self.page = None
            return
        if action == Action.ENTER:
            self.page = PAGES[self.selected]
            if self.selected == 3:
                self.message_mode = "choose"
            return
        step = -1 if action == Action.UP else 1
        self.selected = (self.selected + step) % len(PAGES)
        if self.selected < self.offset:
            self.offset = self.selected
        elif self.selected >= self.offset + self.visible_rows:
            self.offset = self.selected - self.visible_rows + 1

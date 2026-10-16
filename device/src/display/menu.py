"""Estado de navegación de la OLED; no accede a sensores, red ni GPIO.

`Menu.handle()` devuelve intenciones (enviar, grabar, confirmar un aviso...)
que ejecuta la aplicación; el resultado vuelve al menú mediante sus métodos.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..alerts.levels import DANGER, Assessment
from ..communication.catalog import MESSAGES
from ..events import Action, NoticeReceived, TransportEvent
from ..sensors.readings import SensorSnapshot

__all__ = ["Action", "Menu", "PAGES"]

PAGES = ("Estado", "Gases", "Temperatura", "Mensajes", "Voz", "Ajustes")
MESSAGES_PAGE = PAGES.index("Mensajes")
VOICE_PAGE = PAGES.index("Voz")


# Intents executed by the application.
@dataclass(frozen=True)
class SendMessage:
    code: str


@dataclass(frozen=True)
class StartRecording:
    pass


@dataclass(frozen=True)
class StopRecording:
    pass


@dataclass(frozen=True)
class SendVoice:
    pass


@dataclass(frozen=True)
class DiscardVoice:
    pass


@dataclass(frozen=True)
class AcknowledgeNotice:
    notice_id: int


@dataclass(frozen=True)
class SilenceAlarm:
    pass


Intent = SendMessage | StartRecording | StopRecording | SendVoice | DiscardVoice | AcknowledgeNotice | SilenceAlarm


@dataclass
class LinkState:
    configured: bool = False
    connected: bool = False
    identity: dict = field(default_factory=dict)
    blocked: str = ""


class Menu:
    visible_rows = 3

    def __init__(self):
        self.selected = 0
        self.offset = 0
        self.page: int | None = None
        # Messages page.
        self.message_mode: str | None = None
        self.message_selected = 0
        self.message_offset = 0
        self.confirm_selected = 0
        self.pending_id: str | None = None
        self.delivery_status = ""
        # Voice page: idle, recording, confirm or result.
        self.voice_mode = "idle"
        self.voice_status = ""
        self.voice_confirm_selected = 0
        self.voice_duration_ms = 0
        self.recording_seconds = 0
        self.pending_voice_id: str | None = None
        # Live data.
        self.link = LinkState()
        self.snapshot = SensorSnapshot()
        self.assessment = Assessment()
        self.pending_messages = 0
        self.pending_voices = 0
        # Overlays: central notices first, then the danger alarm.
        self.notices: list[NoticeReceived] = []
        self.alarm_visible = False

    # --- live updates -------------------------------------------------
    @property
    def connected(self) -> bool:
        return self.link.connected

    @property
    def notice(self) -> NoticeReceived | None:
        return self.notices[0] if self.notices else None

    def transport(self, event: TransportEvent) -> None:
        if event.kind == "connected":
            self.link.connected = True
        elif event.kind == "disconnected":
            self.link.connected = False
        elif event.kind == "identity":
            self.link.identity = dict(event.data)
            self.link.blocked = ""
        elif event.kind == "blocked":
            self.link.blocked = event.detail
        elif event.kind == "delivered":
            self.link.blocked = ""
            if self.pending_id is not None and event.message_id == self.pending_id:
                self.delivery_status = "Enviado a central"
        elif event.kind == "rejected" and self.pending_id is not None and event.message_id == self.pending_id:
            self.delivery_status = "Rechazado"

    def monitor(self, snapshot: SensorSnapshot, assessment: Assessment) -> None:
        if assessment.level == DANGER and self.assessment.level != DANGER:
            self.alarm_visible = True
        elif assessment.level != DANGER:
            self.alarm_visible = False
        self.snapshot, self.assessment = snapshot, assessment

    def receive_notice(self, notice: NoticeReceived) -> bool:
        """Queue a notice for display; returns False if it is already shown or queued."""
        if any(current.notice_id == notice.notice_id for current in self.notices):
            return False
        self.notices.append(notice)
        return True

    # --- results of intents -------------------------------------------
    def message_queued(self, message_id: str) -> None:
        self.pending_id, self.delivery_status = message_id, "Guardado en cola"

    def message_failed(self, status: str) -> None:
        self.pending_id, self.delivery_status = None, status

    def recording_started(self) -> None:
        self.voice_mode, self.recording_seconds = "recording", 0

    def recording_progress(self, seconds: int) -> None:
        self.recording_seconds = seconds

    def recording_finished(self, duration_ms: int) -> None:
        self.voice_mode, self.voice_duration_ms, self.voice_confirm_selected = "confirm", duration_ms, 0

    def recording_failed(self, status: str) -> None:
        self.voice_mode, self.voice_status, self.voice_confirm_selected = "result", status, 0

    def voice_result(self, status: str, voice_id: str | None = None) -> None:
        self.voice_mode, self.voice_status, self.pending_voice_id = "result", status, voice_id

    def voice_uploaded(self, voice_id: str) -> None:
        if self.pending_voice_id is not None and voice_id == self.pending_voice_id:
            self.voice_status = "Enviado a central"

    def voice_rejected(self, voice_id: str) -> None:
        if self.pending_voice_id is not None and voice_id == self.pending_voice_id:
            self.voice_status = "Rechazado"

    # --- navigation ---------------------------------------------------
    def handle(self, action: Action) -> tuple[Intent, ...]:
        if self.notice is not None:
            if action == Action.ENTER:
                notice = self.notices.pop(0)
                return (AcknowledgeNotice(notice.notice_id),)
            return ()
        if self.alarm_visible:
            if action == Action.ENTER:
                self.alarm_visible = False
                return (SilenceAlarm(),)
            return ()
        if self.page == MESSAGES_PAGE:
            return self._messages(action)
        if self.page == VOICE_PAGE:
            return self._voice(action)
        if self.page is not None:
            if action == Action.ENTER:
                self.page = None
            return ()
        if action == Action.ENTER:
            self.page = self.selected
            if self.page == MESSAGES_PAGE:
                self.message_mode = "choose"
            elif self.page == VOICE_PAGE:
                self.voice_mode, self.voice_confirm_selected = "idle", 0
            return ()
        self.selected, self.offset = _scroll(self.selected, self.offset, len(PAGES), action, self.visible_rows)
        return ()

    def _messages(self, action: Action) -> tuple[Intent, ...]:
        if self.message_mode == "result":
            if action == Action.ENTER:
                self.message_mode = "choose"
            return ()
        if self.message_mode == "confirm":
            if action in (Action.UP, Action.DOWN):
                self.confirm_selected = 1 - self.confirm_selected
                return ()
            self.message_mode = "choose" if self.confirm_selected == 1 else "result"
            return () if self.confirm_selected == 1 else (SendMessage(MESSAGES[self.message_selected][0]),)
        if action == Action.ENTER:
            if self.message_selected == len(MESSAGES):
                self.page, self.message_mode = None, None
            else:
                self.confirm_selected, self.message_mode = 0, "confirm"
            return ()
        self.message_selected, self.message_offset = _scroll(self.message_selected, self.message_offset, len(MESSAGES) + 1, action, self.visible_rows)
        return ()

    def _voice(self, action: Action) -> tuple[Intent, ...]:
        if self.voice_mode == "recording":
            return (StopRecording(),) if action == Action.ENTER else ()
        if self.voice_mode == "confirm":
            if action in (Action.UP, Action.DOWN):
                self.voice_confirm_selected = 1 - self.voice_confirm_selected
                return ()
            if self.voice_confirm_selected == 1:
                self.voice_mode, self.voice_confirm_selected = "idle", 0
                return (DiscardVoice(),)
            return (SendVoice(),)
        if self.voice_mode == "result":
            if action == Action.ENTER:
                self.voice_mode, self.voice_confirm_selected = "idle", 0
            return ()
        # Idle: two options, Grabar and Volver.
        if action in (Action.UP, Action.DOWN):
            self.voice_confirm_selected = 1 - self.voice_confirm_selected
            return ()
        if self.voice_confirm_selected == 1:
            self.page, self.voice_confirm_selected = None, 0
            return ()
        return (StartRecording(),)


def _scroll(selected: int, offset: int, count: int, action: Action, rows: int) -> tuple[int, int]:
    """Move the selection with wrap-around and keep it inside the visible window."""
    selected = (selected + (-1 if action == Action.UP else 1)) % count
    if selected < offset:
        offset = selected
    elif selected >= offset + rows:
        offset = selected - rows + 1
    return selected, offset

"""Eventos que llegan al hilo principal desde botones, red, sensores y audio."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Action(Enum):
    UP = "up"
    DOWN = "down"
    ENTER = "enter"


@dataclass(frozen=True)
class TransportEvent:
    """Estado del enlace con la central.

    kind: connected, disconnected, identity, delivered, rejected o blocked.
    """

    kind: str
    message_id: str | None = None
    detail: str = ""
    data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class NoticeReceived:
    notice_id: int
    code: str
    text: str
    severity: str


@dataclass(frozen=True)
class VoiceEvent:
    """kind: uploaded o rejected."""

    kind: str
    voice_id: str
    detail: str = ""

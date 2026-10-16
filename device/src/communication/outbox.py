"""Cola durable de tramas para la central.

Cada entrada es un archivo JSON con la trama exacta que se enviará. Solo se
borra al recibir el `ack` correspondiente; un reintento conserva el mismo
identificador, por lo que la central no duplica registros.
"""
from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .catalog import AUTOMATIC_MESSAGES, MESSAGE_CODES
from .storage import QueueDirectory

ENTRY_ID = re.compile(r"[0-9a-f]{32}")
MAX_DETAIL = 120


@dataclass(frozen=True)
class Entry:
    entry_id: str
    frame: dict
    path: Path

    @property
    def type(self) -> str:
        return self.frame.get("type", "")


class Outbox:
    def __init__(self, path: str | Path):
        self.directory = QueueDirectory(path)

    @property
    def path(self) -> Path:
        return self.directory.path

    def enqueue_message(self, code: str, detail: str | None = None) -> str:
        if code not in MESSAGE_CODES:
            raise ValueError("Mensaje fuera del catálogo")
        if detail is not None and (code not in AUTOMATIC_MESSAGES or not 0 < len(detail) <= MAX_DETAIL):
            raise ValueError("Detalle inválido")
        message_id = uuid.uuid4().hex
        frame = {"type": "message", "clientMessageId": message_id, "code": code, "sentAt": datetime.now(timezone.utc).isoformat()}
        if detail is not None:
            frame["detail"] = detail
        self._write(message_id, frame)
        return message_id

    def enqueue_notice_ack(self, notice_id: int, stage: str) -> str:
        if stage not in ("delivered", "read") or type(notice_id) is not int:
            raise ValueError("Confirmación de aviso inválida")
        entry_id = uuid.uuid4().hex
        self._write(entry_id, {"type": "notice-ack", "noticeId": notice_id, "stage": stage})
        return entry_id

    def entries(self) -> list[Entry]:
        """Pending entries, oldest first."""
        with self.directory.locked():
            result = []
            for path in sorted(self.path.glob("*.json")):
                entry_id = path.stem.rsplit("-", 1)[-1]
                if ENTRY_ID.fullmatch(entry_id):
                    result.append(Entry(entry_id, json.loads(path.read_text(encoding="utf-8")), path))
            return result

    def first(self, skip_messages: bool = False) -> Entry | None:
        """Oldest entry; notice confirmations can go ahead while messages wait for an assignment."""
        for entry in self.entries():
            if not (skip_messages and entry.type == "message"):
                return entry
        return None

    def acknowledge(self, entry_id: str) -> None:
        if not isinstance(entry_id, str) or ENTRY_ID.fullmatch(entry_id) is None:
            return
        with self.directory.locked():
            for path in self.path.glob(f"*-{entry_id}.json"):
                path.unlink()
            self.directory.sync()

    def reject(self, entry_id: str, reason: str) -> None:
        if ENTRY_ID.fullmatch(entry_id) is None:
            return
        with self.directory.locked():
            self.directory.quarantine(list(self.path.glob(f"*-{entry_id}.json")), reason)

    def has_notice_ack(self, notice_id: int, stage: str) -> bool:
        return any(entry.type == "notice-ack" and entry.frame.get("noticeId") == notice_id and entry.frame.get("stage") == stage
                   for entry in self.entries())

    @property
    def pending(self) -> int:
        with self.directory.locked():
            return len(list(self.path.glob("*.json")))

    @property
    def pending_messages(self) -> int:
        return sum(1 for entry in self.entries() if entry.type == "message")

    def _write(self, entry_id: str, frame: dict) -> None:
        content = json.dumps(frame, ensure_ascii=False, allow_nan=False).encode("utf-8")
        with self.directory.locked():
            self.directory.write_atomic(f"{time.time_ns():020d}-{entry_id}.json", content)

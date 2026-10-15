"""Cola durable de mensajes de voz (WAV + metadatos) pendientes de subir."""
from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .storage import QueueDirectory

VOICE_ID = re.compile(r"[0-9a-f]{32}")


class VoiceQueueFull(Exception):
    pass


@dataclass(frozen=True)
class QueuedVoice:
    voice_id: str
    audio: Path
    metadata: Path
    recorded_at: str
    duration_ms: int


class VoiceQueue:
    def __init__(self, path: str | Path, max_pending: int):
        self.directory = QueueDirectory(path)
        self.max_pending = max_pending

    @property
    def path(self) -> Path:
        return self.directory.path

    def enqueue(self, audio: bytes, duration_ms: int) -> str:
        voice_id = uuid.uuid4().hex
        stem = f"{time.time_ns():020d}-{voice_id}"
        metadata = {"voiceId": voice_id, "recordedAt": datetime.now(timezone.utc).isoformat(), "durationMs": duration_ms}
        with self.directory.locked():
            if self._count() >= self.max_pending:
                raise VoiceQueueFull("Cola de voz llena")
            # The audio is written first; the metadata file marks the entry as complete.
            self.directory.write_atomic(f"{stem}.wav", audio)
            self.directory.write_atomic(f"{stem}.json", json.dumps(metadata).encode("utf-8"))
        return voice_id

    def first(self) -> QueuedVoice | None:
        with self.directory.locked():
            for metadata in sorted(self.path.glob("*.json")):
                voice_id = metadata.stem.rsplit("-", 1)[-1]
                audio = metadata.with_suffix(".wav")
                if VOICE_ID.fullmatch(voice_id) and audio.exists():
                    data = json.loads(metadata.read_text(encoding="utf-8"))
                    return QueuedVoice(voice_id, audio, metadata, data["recordedAt"], data["durationMs"])
            return None

    def remove(self, voice: QueuedVoice) -> None:
        with self.directory.locked():
            voice.metadata.unlink(missing_ok=True)
            voice.audio.unlink(missing_ok=True)
            self.directory.sync()

    def reject(self, voice: QueuedVoice, reason: str) -> None:
        with self.directory.locked():
            self.directory.quarantine([voice.metadata, voice.audio], reason)

    @property
    def pending(self) -> int:
        with self.directory.locked():
            return self._count()

    def _count(self) -> int:
        return len(list(self.path.glob("*.json")))

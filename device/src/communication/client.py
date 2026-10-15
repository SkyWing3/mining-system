"""WebSocket en segundo plano. Solo borra mensajes tras la confirmación del servidor."""
import json
import fcntl
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue
from .catalog import MESSAGES


@dataclass(frozen=True)
class TransportEvent:
    kind: str
    message_id: str | None = None
    detail: str = ""


class Outbox:
    def __init__(self, path):
        self.path = Path(path).resolve()
        if self.path.is_file():
            raise ValueError("outbox_path debe ser un directorio. Conserva y exporta primero la cola antigua; consulta docs/mysql.md.")
        self.path.mkdir(parents=True, exist_ok=True, mode=0o700)

    @contextmanager
    def locked(self):
        # Separate instances/processes share the same advisory lock on Linux/macOS.
        descriptor = os.open(self.path / ".lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def sync_directory(self):
        descriptor = os.open(self.path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def enqueue(self, code):
        if code not in dict(MESSAGES):
            raise ValueError("Mensaje fuera del catálogo")
        message_id = uuid.uuid4().hex
        sent_at = datetime.now(timezone.utc).isoformat()
        payload = {"type": "message", "clientMessageId": message_id, "code": code, "sentAt": sent_at}
        with self.locked():
            final = self.path / f"{time.time_ns():020d}-{message_id}.json"
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path, prefix=".", suffix=".tmp", delete=False) as output:
                    temporary = Path(output.name)
                    json.dump(payload, output, ensure_ascii=False, allow_nan=False)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, final)
                self.sync_directory()
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        return message_id

    def first(self):
        with self.locked():
            files = sorted(self.path.glob("*.json"))
            if not files:
                return None
            payload = json.loads(files[0].read_text(encoding="utf-8"))
            return payload["clientMessageId"], payload

    def acknowledge(self, message_id):
        if not isinstance(message_id, str) or re.fullmatch(r"[0-9a-f]{32}", message_id) is None:
            return
        with self.locked():
            for path in self.path.glob(f"*-{message_id}.json"):
                path.unlink()
            self.sync_directory()

    @property
    def pending(self):
        with self.locked():
            return len(list(self.path.glob("*.json")))


class DeviceClient:
    def __init__(self, config, events: Queue, telemetry=None):
        self.config = config
        self.events = events
        self.telemetry = telemetry
        self.outbox = Outbox(config["outbox_path"])
        self.connected = False
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._socket = None
        self._thread = None

    def start(self):
        if self._thread is not None:
            raise RuntimeError("El cliente ya está iniciado")
        self._thread = threading.Thread(target=self._run, name="mining-websocket", daemon=True)
        self._thread.start()

    def send(self, code):
        message_id = self.outbox.enqueue(code)
        self._wake.set()
        return message_id

    def close(self):
        self._stop.set()
        self._wake.set()
        if self._socket:
            self._socket.close()
        if self._thread:
            self._thread.join(timeout=12)

    def _exchange(self, socket, frame):
        socket.send(json.dumps(frame, allow_nan=False))
        result = json.loads(socket.recv(timeout=10))
        if result.get("type") != "ack":
            raise ValueError(result.get("message", "Respuesta inválida de la central"))
        if frame.get("type") == "message":
            if result.get("clientMessageId") != frame["clientMessageId"] or not result.get("messageId"):
                raise ValueError("La confirmación no corresponde al mensaje")
        return result

    def _run(self):
        from websockets.sync.client import connect
        retry = 1
        while not self._stop.is_set():
            try:
                with connect(self.config["url"], additional_headers={"X-Device-Key": self.config["api_key"]}, proxy=None, open_timeout=8, close_timeout=2, max_size=8192) as socket:
                    self._socket = socket
                    self._exchange(socket, {"type": "heartbeat"})
                    self.connected = True
                    self.events.put(TransportEvent("connected"))
                    retry = 1
                    next_heartbeat = time.monotonic() + self.config["heartbeat_seconds"]
                    while not self._stop.is_set():
                        self._wake.clear()
                        # Check presence even if many offline messages are being drained.
                        if time.monotonic() >= next_heartbeat:
                            readings = self.telemetry() if self.telemetry else None
                            self._exchange(socket, {"type": "telemetry", **readings} if readings else {"type": "heartbeat"})
                            next_heartbeat = time.monotonic() + self.config["heartbeat_seconds"]
                        queued = self.outbox.first()
                        if queued:
                            message_id, payload = queued
                            self._exchange(socket, payload)
                            self.outbox.acknowledge(message_id)
                            self.events.put(TransportEvent("delivered", message_id))
                            continue
                        self._wake.wait(timeout=max(0, next_heartbeat - time.monotonic()))
            except Exception as error:
                if not self._stop.is_set():
                    logging.warning("Enlace con la central interrumpido: %s", error)
                    self.events.put(TransportEvent("disconnected", detail=str(error)))
            finally:
                self.connected = False
                self._socket = None
            if self._stop.wait(retry):
                break
            retry = min(retry * 2, 20)

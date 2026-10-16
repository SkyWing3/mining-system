"""Enlace WebSocket con la central en segundo plano.

Un hilo emisor mantiene una sola solicitud en vuelo (telemetría, heartbeat o
una entrada de la cola) y un hilo lector separa las respuestas `ack`/`error`
de los avisos que la central envía por iniciativa propia. Las entradas de la
cola solo se borran tras el `ack` que les corresponde.
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from typing import Callable

from ..config import ConnectionConfig
from ..events import NoticeReceived, TransportEvent
from .outbox import Entry, Outbox

log = logging.getLogger(__name__)

RESPONSE_TIMEOUT = 10
MAX_RETRY = 20
# Messages waiting for an assignment (or a temporary server failure) are retried at this pace.
BLOCKED_RETRY = 10
_CLOSED = object()


class ServerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class LinkClosed(Exception):
    pass


class DeviceClient:
    def __init__(self, config: ConnectionConfig, events: queue.Queue, telemetry: Callable[[], dict | None] | None = None,
                 outbox: Outbox | None = None, connect=None, clock=time.monotonic):
        self.config = config
        self.events = events
        self.telemetry = telemetry
        self.outbox = outbox or Outbox(config.outbox_path)
        self._connect = connect
        self._clock = clock
        self.connected = False
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._socket = None
        self._thread: threading.Thread | None = None
        self._responses: queue.Queue = queue.Queue()
        self._blocked_until = 0.0

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("El cliente ya está iniciado")
        self._thread = threading.Thread(target=self._run, name="mining-websocket", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        self._wake.set()
        socket = self._socket
        if socket is not None:
            socket.close()
        if self._thread:
            self._thread.join(timeout=12)

    def send(self, code: str, detail: str | None = None) -> str:
        """Persist a message in the outbox and wake the sender. Returns its stable identifier."""
        message_id = self.outbox.enqueue_message(code, detail)
        self._wake.set()
        return message_id

    def acknowledge_notice(self, notice_id: int, stage: str) -> None:
        self.outbox.enqueue_notice_ack(notice_id, stage)
        self._wake.set()

    def _run(self) -> None:
        connect = self._connect
        if connect is None:
            from websockets.sync.client import connect
        retry = 1
        while not self._stop.is_set():
            try:
                with connect(self.config.url, additional_headers={"X-Device-Key": self.config.api_key}, proxy=None,
                             open_timeout=8, close_timeout=2, max_size=8192) as socket:
                    self._socket = socket
                    self._session(socket)
                    retry = 1
            except Exception as error:
                if not self._stop.is_set():
                    log.warning("Enlace con la central interrumpido: %s", error)
                    self.events.put(TransportEvent("disconnected", detail=str(error)))
            finally:
                if self.connected:
                    retry = 1
                self.connected = False
                self._socket = None
            if self._stop.wait(retry):
                break
            retry = min(retry * 2, MAX_RETRY)

    def _session(self, socket) -> None:
        self._responses = queue.Queue()
        reader = threading.Thread(target=self._read, args=(socket, self._responses), name="mining-websocket-reader", daemon=True)
        reader.start()
        ack = self._request(socket, {"type": "heartbeat"})
        self.connected = True
        self.events.put(TransportEvent("connected"))
        if isinstance(ack.get("device"), dict):
            self.events.put(TransportEvent("identity", data=ack["device"]))
        now = self._clock()
        next_telemetry = now + self.config.telemetry_seconds if self.telemetry else float("inf")
        next_heartbeat = now + self.config.heartbeat_seconds
        while not self._stop.is_set():
            self._wake.clear()
            now = self._clock()
            # Live readings keep flowing even while a long offline queue is being drained.
            if now >= next_telemetry:
                readings = self.telemetry()
                if readings:
                    self._send_telemetry(socket, readings)
                    next_heartbeat = now + self.config.heartbeat_seconds
                next_telemetry = now + self.config.telemetry_seconds
            if now >= next_heartbeat:
                self._request(socket, {"type": "heartbeat"})
                next_heartbeat = now + self.config.heartbeat_seconds
            entry = self.outbox.first(skip_messages=now < self._blocked_until)
            if entry is not None:
                self._deliver(socket, entry)
                continue
            deadline = min(next_telemetry, next_heartbeat)
            if self._blocked_until > now:
                deadline = min(deadline, self._blocked_until)
            self._wake.wait(timeout=max(0.0, deadline - self._clock()))
        socket.close()

    def _send_telemetry(self, socket, readings: dict) -> None:
        try:
            self._request(socket, {"type": "telemetry", **readings})
        except ServerError as error:
            # A rejected reading is dropped; it must never block the link.
            log.warning("La central rechazó una lectura: %s", error)

    def _deliver(self, socket, entry: Entry) -> None:
        try:
            ack = self._request(socket, entry.frame)
        except ServerError as error:
            if error.code == "invalid":
                self.outbox.reject(entry.entry_id, str(error))
                self.events.put(TransportEvent("rejected", entry.entry_id, str(error)))
            else:
                # Unassigned device or temporary failure: keep the entry and retry later.
                self._blocked_until = self._clock() + BLOCKED_RETRY
                self.events.put(TransportEvent("blocked", entry.entry_id, str(error)))
            return
        if entry.type == "message" and (ack.get("clientMessageId") != entry.frame["clientMessageId"] or not ack.get("messageId")):
            raise ValueError("La confirmación no corresponde al mensaje")
        self.outbox.acknowledge(entry.entry_id)
        self._blocked_until = 0.0
        if entry.type == "message":
            self.events.put(TransportEvent("delivered", entry.entry_id))

    def _request(self, socket, frame: dict) -> dict:
        socket.send(json.dumps(frame, allow_nan=False))
        try:
            response = self._responses.get(timeout=RESPONSE_TIMEOUT)
        except queue.Empty:
            raise TimeoutError("La central no respondió a tiempo") from None
        if response is _CLOSED:
            raise LinkClosed("La central cerró el enlace")
        if response.get("type") == "error":
            raise ServerError(str(response.get("code", "unavailable")), str(response.get("message", "Error de la central")))
        if response.get("type") != "ack":
            raise ValueError("Respuesta inválida de la central")
        return response

    def _read(self, socket, responses: queue.Queue) -> None:
        try:
            for raw in socket:
                try:
                    frame = json.loads(raw)
                except (TypeError, ValueError):
                    log.warning("Trama inválida de la central")
                    continue
                if not isinstance(frame, dict):
                    continue
                if frame.get("type") == "notice":
                    self._notice(frame)
                else:
                    responses.put(frame)
        except Exception as error:
            if not self._stop.is_set():
                log.debug("Lectura del enlace terminada: %s", error)
        finally:
            responses.put(_CLOSED)

    def _notice(self, frame: dict) -> None:
        notice_id = frame.get("noticeId")
        if type(notice_id) is not int:
            return
        # A notice the miner already confirmed offline is not shown again.
        if self.outbox.has_notice_ack(notice_id, "read"):
            return
        if not self.outbox.has_notice_ack(notice_id, "delivered"):
            self.outbox.enqueue_notice_ack(notice_id, "delivered")
            self._wake.set()
        self.events.put(NoticeReceived(notice_id, str(frame.get("code", "")), str(frame.get("text", "")), str(frame.get("severity", "info"))))

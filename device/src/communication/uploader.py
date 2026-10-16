"""Subida HTTP de mensajes de voz, idempotente y con reintentos.

Se usa HTTP porque una grabación supera el límite de 8 KB de las tramas del
WebSocket. El identificador estable de cada grabación evita duplicados.
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import urllib.error
import urllib.request

from ..events import VoiceEvent
from .voice_queue import QueuedVoice, VoiceQueue

log = logging.getLogger(__name__)

# Responses that can never succeed: the recording is moved to rejected/.
PERMANENT_FAILURES = (400, 413, 415)
MAX_BACKOFF = 60
IDLE_WAIT = 30


class VoiceUploader:
    def __init__(self, url: str, api_key: str, voices: VoiceQueue, events: queue.Queue, opener=None):
        self.url = url
        self.api_key = api_key
        self.voices = voices
        self.events = events
        # The central is reached directly on the LAN, like the WebSocket (no environment proxies).
        self._open = opener or urllib.request.build_opener(urllib.request.ProxyHandler({})).open
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("La subida de voz ya está iniciada")
        self._thread = threading.Thread(target=self._run, name="mining-voice-upload", daemon=True)
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def close(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=15)

    def upload_next(self) -> bool | None:
        """Upload the oldest recording. True: done, False: retry later, None: nothing pending."""
        voice = self.voices.first()
        if voice is None:
            return None
        status, detail = self._post(voice)
        if status in (200, 201):
            self.voices.remove(voice)
            self.events.put(VoiceEvent("uploaded", voice.voice_id))
            return True
        if status in PERMANENT_FAILURES:
            self.voices.reject(voice, detail)
            self.events.put(VoiceEvent("rejected", voice.voice_id, detail))
            return True
        log.warning("Subida de voz pendiente (%s): %s", status, detail)
        return False

    def _run(self) -> None:
        backoff = 2
        while not self._stop.is_set():
            self._wake.clear()
            try:
                result = self.upload_next()
            except OSError as error:
                log.warning("No se pudo leer la cola de voz: %s", error)
                result = False
            if result is True:
                backoff = 2
                continue
            wait = IDLE_WAIT if result is None else backoff
            if result is False:
                backoff = min(backoff * 2, MAX_BACKOFF)
            self._wake.wait(timeout=wait)

    def _post(self, voice: QueuedVoice) -> tuple[int, str]:
        request = urllib.request.Request(self.url, data=voice.audio.read_bytes(), method="POST", headers={
            "Content-Type": "audio/wav",
            "X-Device-Key": self.api_key,
            "X-Client-Message-Id": voice.voice_id,
            "X-Recorded-At": voice.recorded_at,
        })
        try:
            with self._open(request, timeout=30) as response:
                return response.status, ""
        except urllib.error.HTTPError as error:
            with error:
                return error.code, _message(error)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return 0, str(error)


def _message(error: urllib.error.HTTPError) -> str:
    try:
        return str(json.loads(error.read() or b"{}").get("message", error.reason))
    except (ValueError, AttributeError):
        return str(error.reason)

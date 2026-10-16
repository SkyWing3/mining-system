"""Orquestación de la manilla: sensores, alertas, red, voz y OLED.

Todos los cambios de estado ocurren en el hilo principal, que consume una cola
de eventos. Los demás hilos (sensores, WebSocket, subida de voz, botones) solo
publican eventos en esa cola.
"""
from __future__ import annotations

import logging
import time
from queue import Empty, Queue
from typing import Callable

from .alerts.controller import AlertController
from .alerts.levels import DANGER, NORMAL, Assessment, ThresholdEvaluator
from .alerts.outputs import AlertOutputs, GpioOutputs, SimulatedOutputs
from .audio.recorder import ArecordRecorder, Recorder, RecorderError, Recording, SimulatedRecorder
from .communication.catalog import CO_ALARM, HEAT_ALARM
from .communication.client import DeviceClient
from .communication.uploader import VoiceUploader
from .communication.voice_queue import VoiceQueue, VoiceQueueFull
from .config import Settings
from .display.menu import (AcknowledgeNotice, DiscardVoice, Intent, Menu, SendMessage, SendVoice, SilenceAlarm,
                           StartRecording, StopRecording)
from .display.renderer import Renderer
from .events import Action, NoticeReceived, TransportEvent, VoiceEvent
from .sensors.hub import MonitorUpdate, SensorHub
from .sensors.sources import HardwareSensors, SensorSource, SimulatedSensors

log = logging.getLogger(__name__)

ALARM_GROUPS = (("co", CO_ALARM), ("heat", HEAT_ALARM))
MAX_DETAIL = 120


class Application:
    def __init__(self, settings: Settings, *, simulate: bool = False, outputs: AlertOutputs | None = None,
                 sensors: SensorSource | None = None, recorder: Recorder | None = None, clock=time.monotonic):
        self.settings = settings
        self.simulate = simulate
        self._clock = clock
        self.events: Queue = Queue()
        self.menu = Menu()
        self.renderer = Renderer()
        connection = settings.connection if settings.connection and settings.connection.configured else None
        self.menu.link.configured = connection is not None

        if outputs is None:
            outputs = GpioOutputs(settings.alerts) if settings.alerts.enabled and not simulate else SimulatedOutputs()
        self.outputs = outputs
        self.alerts = AlertController(outputs, settings.alerts.silence_seconds, settings.alerts.button_feedback,
                                      monitor_link=connection is not None)

        if sensors is None:
            sensors = SimulatedSensors() if simulate else HardwareSensors(settings.sensors)
        self.sensors = sensors
        self.hub = SensorHub(sensors, ThresholdEvaluator(settings.alerts), settings.sensors.sample_seconds, self.events.put)

        self.client = DeviceClient(connection, self.events, telemetry=self.hub.telemetry) if connection else None
        self.voices = VoiceQueue(connection.voice_outbox_path, settings.voice.max_pending) if connection and settings.voice.enabled else None
        self.uploader = VoiceUploader(connection.voice_url, connection.api_key, self.voices, self.events) if self.voices else None
        if recorder is None and settings.voice.enabled:
            voice = settings.voice
            recorder = SimulatedRecorder(voice.sample_rate, voice.max_seconds) if simulate else ArecordRecorder(voice.alsa_device, voice.sample_rate, voice.max_seconds)
        self.recorder = recorder
        self._recording: Recording | None = None
        self._alarm_armed = {group: True for group, _ in ALARM_GROUPS}
        self._started = False

    # --- lifecycle ------------------------------------------------------
    def start(self) -> None:
        self._started = True
        self.hub.start()
        if self.client:
            self.client.start()
        if self.uploader:
            self.uploader.start()
        self._refresh_pending()

    def close(self) -> None:
        if self.recorder is not None and self.recorder.recording:
            self.recorder.cancel()
        for component in (self.uploader, self.client):
            if component is not None:
                component.close()
        if self._started:
            self.hub.close()
        else:
            self.sensors.close()
        self.alerts.close()
        self.outputs.close()

    def run(self, show: Callable, should_stop: Callable[[], bool] = lambda: False) -> None:
        """Main loop: process events, tick once per second and redraw when the frame changes."""
        last_frame = None
        next_tick = self._clock()
        while not should_stop():
            try:
                self.process(self.events.get(timeout=max(0.0, next_tick - self._clock())))
            except Empty:
                pass
            if self._clock() >= next_tick:
                self.tick()
                next_tick = max(next_tick + 1, self._clock())
            frame = self.renderer.render(self.menu)
            data = frame.tobytes()
            if data != last_frame:
                show(frame)
                last_frame = data

    def run_hardware(self) -> None:
        from luma.core.interface.serial import i2c
        from luma.oled.device import ssd1306

        from .input.buttons import Buttons
        display = self.settings.display
        screen = ssd1306(i2c(port=display.port, address=display.address), width=128, height=64, rotate=display.rotate)
        try:
            buttons = Buttons(self.settings.buttons, self.events)
            try:
                self.start()
                self.run(screen.display)
            finally:
                buttons.close()
        finally:
            screen.cleanup()

    # --- events -----------------------------------------------------------
    def process(self, event) -> None:
        if isinstance(event, Action):
            self.alerts.on_button()
            for intent in self.menu.handle(event):
                self._execute(intent)
        elif isinstance(event, MonitorUpdate):
            self.menu.monitor(event.snapshot, event.assessment)
            self.alerts.on_level(event.assessment.level)
            self._send_alarms(event.assessment, event.snapshot.simulated)
        elif isinstance(event, TransportEvent):
            self.menu.transport(event)
            if event.kind in ("connected", "disconnected"):
                self.alerts.on_connection(event.kind == "connected")
            self._refresh_pending()
        elif isinstance(event, NoticeReceived):
            if self.menu.receive_notice(event):
                self.alerts.on_notice(event.severity)
        elif isinstance(event, VoiceEvent):
            if event.kind == "uploaded":
                self.menu.voice_uploaded(event.voice_id)
            else:
                self.menu.voice_rejected(event.voice_id)
            self._refresh_pending()

    def tick(self) -> None:
        self.alerts.tick()
        recorder = self.recorder
        if recorder is not None and recorder.recording:
            self.menu.recording_progress(int(recorder.elapsed))
            if recorder.elapsed >= self.settings.voice.max_seconds:
                self._finish_recording()
        self._refresh_pending()

    # --- intents ----------------------------------------------------------
    def _execute(self, intent: Intent) -> None:
        if isinstance(intent, SendMessage):
            self._send_message(intent.code)
        elif isinstance(intent, AcknowledgeNotice):
            self._acknowledge(intent.notice_id)
        elif isinstance(intent, SilenceAlarm):
            self.alerts.silence()
        elif isinstance(intent, StartRecording):
            self._start_recording()
        elif isinstance(intent, StopRecording):
            self._finish_recording()
        elif isinstance(intent, SendVoice):
            self._send_voice()
        elif isinstance(intent, DiscardVoice):
            self._recording = None

    def _send_message(self, code: str) -> None:
        if self.client is None:
            self.menu.message_failed("Sin configurar")
            return
        try:
            self.menu.message_queued(self.client.send(code))
        except (OSError, ValueError) as error:
            log.error("No se pudo guardar el mensaje: %s", error)
            self.menu.message_failed("Error al guardar")
        self._refresh_pending()

    def _acknowledge(self, notice_id: int) -> None:
        if self.client is not None:
            try:
                self.client.acknowledge_notice(notice_id, "read")
            except (OSError, ValueError) as error:
                log.error("No se pudo guardar la confirmación del aviso: %s", error)
        next_notice = self.menu.notice
        if next_notice is None:
            self.alerts.on_notice_cleared()

    def _start_recording(self) -> None:
        if self.recorder is None:
            self.menu.recording_failed("Voz desactivada")
        elif self.voices is None:
            self.menu.recording_failed("Sin configurar")
        elif self.voices.pending >= self.voices.max_pending:
            self.menu.recording_failed("Cola de voz llena")
        else:
            try:
                self.recorder.start()
                self.menu.recording_started()
            except RecorderError as error:
                log.error("No se pudo grabar: %s", error)
                self.menu.recording_failed("Micro no disponible")

    def _finish_recording(self) -> None:
        if self.recorder is None or not self.recorder.recording:
            return
        try:
            self._recording = self.recorder.stop()
            self.menu.recording_finished(self._recording.duration_ms)
        except RecorderError as error:
            log.error("Grabación inválida: %s", error)
            self._recording = None
            self.menu.recording_failed("Grabacion invalida")

    def _send_voice(self) -> None:
        recording, self._recording = self._recording, None
        if recording is None or self.voices is None:
            self.menu.voice_result("Sin grabacion")
            return
        try:
            voice_id = self.voices.enqueue(recording.wav, recording.duration_ms)
        except VoiceQueueFull:
            self.menu.voice_result("Cola de voz llena")
            return
        except OSError as error:
            log.error("No se pudo guardar la grabación: %s", error)
            self.menu.voice_result("Error al guardar")
            return
        self.menu.voice_result("Guardado en cola", voice_id)
        if self.uploader:
            self.uploader.wake()
        self._refresh_pending()

    def _send_alarms(self, assessment: Assessment, simulated: bool) -> None:
        """One automatic alert per transition into danger; re-armed when the group returns to normal."""
        for group, code in ALARM_GROUPS:
            level = assessment.group_level(group)
            if level == DANGER and self._alarm_armed[group]:
                self._alarm_armed[group] = False
                detail = assessment.detail(group) + (" (simulado)" if simulated else "")
                if self.client is not None:
                    try:
                        self.client.send(code, detail[:MAX_DETAIL])
                    except (OSError, ValueError) as error:
                        log.error("No se pudo guardar la alarma: %s", error)
            elif level == NORMAL:
                self._alarm_armed[group] = True

    def _refresh_pending(self) -> None:
        try:
            self.menu.pending_messages = self.client.outbox.pending_messages if self.client else 0
            self.menu.pending_voices = self.voices.pending if self.voices else 0
        except OSError as error:
            log.warning("No se pudo leer la cola local: %s", error)

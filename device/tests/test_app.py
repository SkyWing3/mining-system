import json
import tempfile
import unittest
from pathlib import Path

from src.alerts.outputs import SimulatedOutputs
from src.app import Application
from src.audio.recorder import SimulatedRecorder
from src.config import load_config
from src.events import Action, NoticeReceived, TransportEvent, VoiceEvent
from src.sensors.readings import CO_OK, SensorSnapshot

EXAMPLE = Path(__file__).resolve().parents[1] / "config" / "settings.example.json"


class ScriptedSensors:
    def __init__(self):
        self.next = SensorSnapshot()

    def sample(self):
        return self.next

    def close(self):
        pass


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        data = json.loads(EXAMPLE.read_text())
        data["connection"]["api_key"] = "c" * 64
        data["alerts"]["confirm_samples"] = 1
        path = Path(self.folder.name) / "config" / "settings.json"
        path.parent.mkdir()
        path.write_text(json.dumps(data))
        self.settings = load_config(path)
        self.sensors = ScriptedSensors()
        self.clock = Clock()
        self.recorder = SimulatedRecorder(16000, 30, self.clock)
        self.outputs = SimulatedOutputs()
        # Threads are never started: the test drives the main loop directly.
        self.app = Application(self.settings, simulate=True, outputs=self.outputs, sensors=self.sensors, recorder=self.recorder)

    def tearDown(self):
        self.app.close()
        self.folder.cleanup()

    def sample(self, snapshot):
        self.sensors.next = snapshot
        self.app.process(self.app.hub.sample_once())
        while not self.app.events.empty():
            self.app.process(self.app.events.get_nowait())

    def press(self, *actions):
        for action in actions:
            self.app.process(action)

    def test_danger_sends_one_automatic_alarm_per_transition(self):
        danger = SensorSnapshot(co_ppm=250.0, co_volts=0.5, co_state=CO_OK, simulated=True)
        self.sample(danger)
        self.sample(danger)
        entries = self.app.client.outbox.entries()
        self.assertEqual([entry.frame["code"] for entry in entries], ["CO_ALARM"])
        self.assertEqual(entries[0].frame["detail"], "CO 250 ppm (simulado)")
        self.assertTrue(self.app.menu.alarm_visible)
        self.assertEqual(self.outputs.led_color, "red")
        self.press(Action.ENTER)
        self.assertIsNone(self.outputs.buzzer)
        for _ in range(2):
            self.sample(SensorSnapshot(co_ppm=5.0, co_state=CO_OK))
        self.sample(danger)
        self.assertEqual(self.app.client.outbox.pending_messages, 2)

    def test_message_from_menu_is_queued(self):
        self.press(Action.DOWN, Action.DOWN, Action.DOWN, Action.ENTER, Action.ENTER, Action.ENTER)
        self.assertEqual(self.app.menu.delivery_status, "Guardado en cola")
        self.assertEqual(self.app.client.outbox.first().frame["code"], "HELP")
        self.app.process(TransportEvent("delivered", self.app.menu.pending_id))
        self.assertEqual(self.app.menu.delivery_status, "Enviado a central")

    def test_notice_is_confirmed_durably(self):
        self.app.process(NoticeReceived(5, "SURFACE", "Volver a superficie", "warning"))
        self.assertEqual(self.outputs.led_color, "blue")
        self.assertTrue(self.outputs.led_blink)
        self.press(Action.ENTER)
        self.assertTrue(self.app.client.outbox.has_notice_ack(5, "read"))
        self.assertIsNone(self.app.menu.notice)

    def test_voice_flow_records_queues_and_confirms_upload(self):
        self.press(*[Action.DOWN] * 4, Action.ENTER, Action.ENTER)
        self.assertEqual(self.app.menu.voice_mode, "recording")
        self.clock.now = 2.5
        self.app.tick()
        self.assertEqual(self.app.menu.recording_seconds, 2)
        self.press(Action.ENTER)
        self.assertEqual(self.app.menu.voice_mode, "confirm")
        self.press(Action.ENTER)
        self.assertEqual(self.app.menu.voice_status, "Guardado en cola")
        queued = self.app.voices.first()
        self.assertEqual(queued.duration_ms, 2500)
        self.app.process(VoiceEvent("uploaded", queued.voice_id))
        self.assertEqual(self.app.menu.voice_status, "Enviado a central")

    def test_recording_stops_at_the_limit_and_can_be_discarded(self):
        self.press(*[Action.DOWN] * 4, Action.ENTER, Action.ENTER)
        self.clock.now = 31
        self.app.tick()
        self.assertEqual(self.app.menu.voice_mode, "confirm")
        self.press(Action.DOWN, Action.ENTER)
        self.assertEqual(self.app.voices.pending, 0)
        self.assertEqual(self.app.menu.voice_mode, "idle")

    def test_unconfigured_device_never_claims_delivery(self):
        data = json.loads(EXAMPLE.read_text())
        path = Path(self.folder.name) / "config" / "unconfigured.json"
        path.write_text(json.dumps(data))
        app = Application(load_config(path), simulate=True, outputs=SimulatedOutputs(), sensors=ScriptedSensors(), recorder=self.recorder)
        try:
            self.assertIsNone(app.client)
            for action in (Action.DOWN, Action.DOWN, Action.DOWN, Action.ENTER, Action.ENTER, Action.ENTER):
                app.process(action)
            self.assertEqual(app.menu.delivery_status, "Sin configurar")
        finally:
            app.close()

    def test_run_loop_redraws_only_changed_frames(self):
        frames = []
        self.app.events.put(Action.DOWN)
        self.app.run(frames.append, should_stop=lambda: len(frames) >= 2 or self.app.events.empty() and len(frames) >= 1)
        self.assertGreaterEqual(len(frames), 1)
        self.assertEqual(frames[-1].size, (128, 64))


if __name__ == "__main__":
    unittest.main()

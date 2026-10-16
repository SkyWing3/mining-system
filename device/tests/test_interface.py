import json
import tempfile
import types
import unittest
from pathlib import Path
from queue import Queue
from unittest.mock import patch

from src.alerts.levels import Assessment, Condition, DANGER, METRICS
from src.config import load_config
from src.display.menu import PAGES, Action, Menu, AcknowledgeNotice, SilenceAlarm
from src.display.renderer import Renderer
from src.events import NoticeReceived, TransportEvent
from src.input.buttons import Buttons
from src.sensors.readings import CO_UNCALIBRATED, CO_WARMING, THERMOMETER_OK, SensorSnapshot

EXAMPLE = Path(__file__).resolve().parents[1] / "config" / "settings.example.json"


def write_config(folder, data):
    path = Path(folder) / "config.json"
    path.write_text(json.dumps(data))
    return path


class InterfaceTests(unittest.TestCase):
    def test_wrap_and_scroll_keep_selection_visible(self):
        menu = Menu()
        for action in [Action.UP] * 15 + [Action.DOWN] * 15:
            menu.handle(action)
            self.assertLessEqual(menu.offset, menu.selected)
            self.assertLess(menu.selected, menu.offset + menu.visible_rows)
        self.assertEqual(menu.selected, 0)

    def test_every_page_returns_to_same_selection(self):
        menu = Menu()
        for index, title in enumerate(PAGES):
            self.assertEqual(menu.selected, index)
            menu.handle(Action.ENTER)
            self.assertEqual(menu.page, index)
            if title == "Mensajes":
                for _ in range(8):
                    menu.handle(Action.DOWN)
                menu.handle(Action.ENTER)
            elif title == "Voz":
                menu.handle(Action.DOWN)
                menu.handle(Action.ENTER)
            else:
                menu.handle(Action.UP)
                menu.handle(Action.DOWN)
                self.assertEqual(menu.page, index)
                menu.handle(Action.ENTER)
            self.assertIsNone(menu.page)
            self.assertEqual(menu.selected, index)
            menu.handle(Action.DOWN)

    def test_frames_are_native_monochrome_and_change_on_navigation(self):
        menu, renderer = Menu(), Renderer()
        initial = renderer.render(menu)
        self.assertEqual(initial.size, (128, 64))
        self.assertEqual(initial.mode, "1")
        menu.handle(Action.DOWN)
        self.assertNotEqual(initial.tobytes(), renderer.render(menu).tobytes())
        for _ in PAGES:
            title = PAGES[menu.selected]
            menu.handle(Action.ENTER)
            self.assertTrue(renderer.render(menu).getbbox(), title)
            if title == "Voz":
                menu.handle(Action.DOWN)
            elif title == "Mensajes":
                for _ in range(8):
                    menu.handle(Action.DOWN)
            menu.handle(Action.ENTER)
            menu.handle(Action.DOWN)

    def test_live_readings_change_the_frames(self):
        menu, renderer = Menu(), Renderer()
        menu.handle(Action.DOWN)
        menu.handle(Action.ENTER)
        warming = SensorSnapshot(co_volts=0.2, co_state=CO_WARMING, warmup_remaining=95)
        menu.monitor(warming, Assessment())
        first = renderer.render(menu).tobytes()
        menu.monitor(SensorSnapshot(co_volts=0.412, co_state=CO_UNCALIBRATED), Assessment())
        self.assertNotEqual(first, renderer.render(menu).tobytes())
        menu.handle(Action.ENTER)
        menu.handle(Action.DOWN)
        menu.handle(Action.ENTER)
        menu.monitor(SensorSnapshot(ambient_c=24.3, object_c=26.1, thermometer_state=THERMOMETER_OK, simulated=True), Assessment())
        self.assertTrue(renderer.render(menu).getbbox())

    def test_notice_and_alarm_overlays_take_priority(self):
        menu, renderer = Menu(), Renderer()
        danger = Assessment(DANGER, (Condition(METRICS[0], DANGER, 245.0),))
        menu.monitor(SensorSnapshot(co_ppm=245.0), danger)
        self.assertTrue(menu.alarm_visible)
        self.assertEqual(menu.handle(Action.DOWN), ())
        alarm_frame = renderer.render(menu).tobytes()
        self.assertTrue(menu.receive_notice(NoticeReceived(7, "EVACUATE", "Evacuar ahora", "critical")))
        self.assertFalse(menu.receive_notice(NoticeReceived(7, "EVACUATE", "Evacuar ahora", "critical")))
        self.assertNotEqual(alarm_frame, renderer.render(menu).tobytes())
        self.assertEqual(menu.handle(Action.ENTER), (AcknowledgeNotice(7),))
        self.assertIsNone(menu.notice)
        self.assertEqual(menu.handle(Action.ENTER), (SilenceAlarm(),))
        self.assertFalse(menu.alarm_visible)
        # The alarm returns only on a new transition into danger.
        menu.monitor(SensorSnapshot(co_ppm=250.0), danger)
        self.assertFalse(menu.alarm_visible)

    def test_identity_and_link_state(self):
        menu = Menu()
        menu.transport(TransportEvent("connected"))
        menu.transport(TransportEvent("identity", data={"name": "Manilla 01", "minerName": "Javier", "zone": "Norte"}))
        self.assertTrue(menu.connected)
        self.assertEqual(menu.link.identity["name"], "Manilla 01")
        menu.transport(TransportEvent("disconnected"))
        self.assertFalse(menu.connected)


class ConfigTests(unittest.TestCase):
    def test_example_config_loads(self):
        settings = load_config()
        self.assertEqual(settings.display.address, 0x3C)
        self.assertEqual(settings.buttons.enter, 22)
        self.assertEqual(settings.connection.telemetry_seconds, 2)
        self.assertEqual(settings.connection.voice_url, "http://localhost:5080/api/device/voice")
        self.assertIsNone(settings.sensors.co.calibration)
        self.assertEqual(settings.alerts.co_ppm.danger, 200)

    def test_minimal_legacy_config_uses_defaults(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = load_config(write_config(folder, {"display": {"port": 1, "address": "0x3C", "rotate": 0},
                                                         "buttons": {"up": 17, "down": 27, "enter": 22, "bounce_seconds": 0.08}}))
            self.assertIsNone(settings.connection)
            self.assertEqual(settings.alerts.buzzer_pin, 24)
            self.assertEqual(settings.voice.sample_rate, 16000)

    def test_relative_queues_resolve_against_the_file(self):
        data = json.loads(EXAMPLE.read_text())
        with tempfile.TemporaryDirectory() as folder:
            settings = load_config(write_config(folder, data))
            self.assertEqual(settings.connection.outbox_path, (Path(folder) / "../state/outbox").resolve())
            data["connection"]["url"] = "wss://central.example/prefix/ws/device"
            self.assertEqual(load_config(write_config(folder, data)).connection.voice_url, "https://central.example/prefix/api/device/voice")

    def test_duplicate_and_bus_pins_rejected(self):
        for section, key, pin in [("buttons", "enter", 17), ("buttons", "enter", 2), ("buttons", "enter", 16),
                                  ("buttons", "enter", 18), ("buttons", "enter", 28), ("buttons", "up", 24)]:
            data = json.loads(EXAMPLE.read_text())
            data[section][key] = pin
            with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
                load_config(write_config(folder, data))
        data = json.loads(EXAMPLE.read_text())
        data["alerts"]["motor"]["pin"] = 20
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
            load_config(write_config(folder, data))

    def test_invalid_values_rejected(self):
        mutations = [
            lambda d: d["alerts"]["thresholds"].update(co_ppm={"caution": 200, "danger": 35}),
            lambda d: d["sensors"]["co"].update(calibration={"baseline_volts": 0.1, "ppm_per_volt": -1}),
            lambda d: d["sensors"]["co"].update(channel=4),
            lambda d: d["voice"].update(sample_rate=12345),
            lambda d: d["connection"].update(telemetry_seconds=0),
            lambda d: d["connection"].update(url="http://localhost/ws/device"),
            lambda d: d["connection"].update(api_key="short"),
            lambda d: d["connection"].update(voice_outbox_path="../state/outbox"),
        ]
        for mutate in mutations:
            data = json.loads(EXAMPLE.read_text())
            mutate(data)
            with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
                load_config(write_config(folder, data))

    def test_gpio_callbacks_queue_correct_actions_and_close(self):
        class FakeButton:
            created = []

            def __init__(self, pin, **kwargs):
                self.pin, self.options, self.closed = pin, kwargs, False
                self.created.append(self)

            def close(self):
                self.closed = True

        with patch.dict("sys.modules", {"gpiozero": types.SimpleNamespace(Button=FakeButton)}):
            queue = Queue()
            buttons = Buttons(load_config().buttons, queue)
            for button, expected in zip(FakeButton.created, (Action.UP, Action.DOWN, Action.ENTER)):
                self.assertTrue(button.options["pull_up"])
                self.assertEqual(button.options["bounce_time"], 0.08)
                button.when_pressed()
                self.assertEqual(queue.get_nowait(), expected)
            buttons.close()
            self.assertTrue(all(button.closed for button in FakeButton.created))


if __name__ == "__main__":
    unittest.main()

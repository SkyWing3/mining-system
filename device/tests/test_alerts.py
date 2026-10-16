import types
import unittest
from unittest.mock import patch

from src.alerts.controller import BUTTON_VIBRATION, DANGER_BUZZ, DANGER_VIBRATION, NOTICE_VIBRATION, AlertController
from src.alerts.levels import CAUTION, DANGER, NORMAL
from src.alerts.outputs import GpioOutputs, Pattern, SimulatedOutputs
from src.config import AlertsConfig


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.outputs = SimulatedOutputs(self.clock)
        self.controller = AlertController(self.outputs, silence_seconds=60, clock=self.clock)

    def test_led_follows_link_and_level(self):
        self.assertEqual(self.outputs.led_color, "blue")
        self.controller.on_connection(True)
        self.assertEqual((self.outputs.led_color, self.outputs.led_blink), ("green", False))
        self.controller.on_level(CAUTION)
        self.assertEqual(self.outputs.led_color, "yellow")
        self.assertEqual(self.outputs.history[-2], ("buzz", (0.15, 0.0, 1)))
        self.controller.on_level(DANGER)
        self.assertEqual((self.outputs.led_color, self.outputs.led_blink), ("red", True))
        self.controller.on_level(NORMAL)
        self.assertEqual(self.outputs.led_color, "green")
        self.assertIsNone(self.outputs.buzzer)
        self.assertIsNone(self.outputs.motor)

    def test_danger_alarm_can_be_silenced_and_resumes(self):
        self.controller.on_level(DANGER)
        self.assertEqual(self.outputs.history[-3:-1], [("buzz", DANGER_BUZZ), ("vibrate", DANGER_VIBRATION)])
        self.controller.on_button()
        self.assertNotEqual(self.outputs.history[-1], ("vibrate", BUTTON_VIBRATION))
        self.controller.silence()
        self.assertIsNone(self.outputs.buzzer)
        self.controller.tick()
        self.assertIsNone(self.outputs.buzzer)
        self.clock.now += 61
        self.controller.tick()
        self.assertEqual(self.outputs.buzzer.on_time, DANGER_BUZZ[0])

    def test_notice_double_vibration_and_blue_blink(self):
        self.controller.on_connection(True)
        self.controller.on_notice("critical")
        self.assertEqual(self.outputs.motor, Pattern(*NOTICE_VIBRATION, self.clock.now))
        self.assertEqual((self.outputs.led_color, self.outputs.led_blink), ("blue", True))
        self.controller.on_notice_cleared()
        self.assertEqual(self.outputs.led_color, "green")

    def test_button_feedback_and_unmonitored_link(self):
        controller = AlertController(self.outputs, 60, button_feedback=True, monitor_link=False, clock=self.clock)
        self.assertEqual(self.outputs.led_color, "green")
        controller.on_button()
        self.assertEqual(self.outputs.history[-1], ("vibrate", BUTTON_VIBRATION))

    def test_simulated_pattern_timing(self):
        pattern = Pattern(0.25, 0.2, 2, 10.0)
        self.assertTrue(pattern.active(10.1))
        self.assertFalse(pattern.active(10.3))
        self.assertTrue(pattern.active(10.5))
        self.assertFalse(pattern.active(11.0))


class GpioOutputTests(unittest.TestCase):
    def test_gpio_devices_use_configured_pins_and_polarity(self):
        created = {}

        class Device:
            def __init__(self, *pins, **options):
                self.pins, self.options, self.calls, self.closed = pins, options, [], False
                created[type(self).__name__] = self

            def __getattr__(self, name):
                return lambda *args, **kwargs: self.calls.append((name, args, kwargs))

            def close(self):
                self.closed = True

        fake = types.SimpleNamespace(RGBLED=type("RGBLED", (Device,), {}), Buzzer=type("Buzzer", (Device,), {}),
                                     DigitalOutputDevice=type("DigitalOutputDevice", (Device,), {}))
        with patch.dict("sys.modules", {"gpiozero": fake}):
            outputs = GpioOutputs(AlertsConfig())
        self.assertEqual(created["RGBLED"].pins, (5, 6, 13))
        self.assertFalse(created["Buzzer"].options["active_high"])
        self.assertEqual(created["DigitalOutputDevice"].pins, (23,))
        outputs.buzz(0.4, 0.4, None)
        self.assertEqual(created["Buzzer"].calls[-1], ("beep", (), {"on_time": 0.4, "off_time": 0.4, "n": None, "background": True}))
        outputs.close()
        self.assertTrue(all(device.closed for device in created.values()))


if __name__ == "__main__":
    unittest.main()

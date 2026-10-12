import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from src.config import load_config
from src.display.menu import Action, Menu, PAGES
from src.display.renderer import Renderer
from src.communication.catalog import MESSAGES
from src.input.buttons import Buttons
from queue import Queue


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
        for index, page in enumerate(PAGES):
            self.assertEqual(menu.selected, index)
            menu.handle(Action.ENTER)
            self.assertEqual(menu.page, page)
            if page.title == 'Mensajes':
                for _ in MESSAGES:
                    menu.handle(Action.DOWN)
                menu.handle(Action.ENTER)
                self.assertIsNone(menu.page)
                self.assertEqual(menu.selected, index)
                menu.handle(Action.DOWN)
                continue
            menu.handle(Action.UP)
            menu.handle(Action.DOWN)
            self.assertEqual(menu.page, page)
            menu.handle(Action.ENTER)
            self.assertIsNone(menu.page)
            self.assertEqual(menu.selected, index)
            menu.handle(Action.DOWN)

    def test_frames_are_native_monochrome_and_change_on_navigation(self):
        menu, renderer = Menu(), Renderer()
        initial = renderer.render(menu)
        self.assertEqual(initial.size, (128, 64))
        self.assertEqual(initial.mode, '1')
        menu.handle(Action.DOWN)
        self.assertNotEqual(initial.tobytes(), renderer.render(menu).tobytes())
        for _ in PAGES:
            menu.handle(Action.ENTER)
            frame = renderer.render(menu)
            self.assertTrue(frame.getbbox())
            menu.handle(Action.ENTER)
            menu.handle(Action.DOWN)

    def test_example_config_loads(self):
        config = load_config()
        self.assertEqual(config['display']['address'], 0x3C)
        self.assertEqual(config['buttons']['enter'], 22)

    def test_duplicate_and_i2c_pins_rejected(self):
        for pin in [17, 2, 3, 28]:
            config = load_config()
            config['buttons']['enter'] = pin
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'config.json'
                path.write_text(json.dumps(config))
                with self.assertRaises(ValueError):
                    load_config(path)

    def test_gpio_callbacks_queue_correct_actions_and_close(self):
        class FakeButton:
            created = []
            def __init__(self, pin, **kwargs):
                self.pin, self.options, self.closed = pin, kwargs, False
                self.created.append(self)
            def close(self):
                self.closed = True
        import types
        with patch.dict('sys.modules', {'gpiozero': types.SimpleNamespace(Button=FakeButton)}):
            queue = Queue()
            buttons = Buttons(load_config()['buttons'], queue)
            for button, expected in zip(FakeButton.created, (Action.UP, Action.DOWN, Action.ENTER)):
                self.assertTrue(button.options['pull_up'])
                self.assertEqual(button.options['bounce_time'], 0.08)
                button.when_pressed()
                self.assertEqual(queue.get_nowait(), expected)
            buttons.close()
            self.assertTrue(all(button.closed for button in FakeButton.created))


if __name__ == '__main__':
    unittest.main()

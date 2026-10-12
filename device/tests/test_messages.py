import json
import tempfile
import unittest
from pathlib import Path
from src.communication.catalog import MESSAGES
from src.communication.client import DeviceClient, Outbox, TransportEvent
from src.display.menu import Action, Menu
from src.display.renderer import Renderer
from queue import Queue


class MessageTests(unittest.TestCase):
    def open_messages(self, sender=None):
        menu = Menu(sender)
        for _ in range(3):
            menu.handle(Action.DOWN)
        menu.handle(Action.ENTER)
        return menu

    def test_selection_does_not_send_until_confirmed(self):
        sent = []
        menu = self.open_messages(lambda code: sent.append(code) or 'test-id')
        menu.handle(Action.ENTER)
        self.assertEqual(menu.message_mode, 'confirm')
        self.assertEqual(sent, [])
        menu.handle(Action.ENTER)
        self.assertEqual(sent, ['HELP'])
        self.assertEqual(menu.delivery_status, 'Guardado en cola')
        menu.transport(TransportEvent('delivered', 'another-id'))
        self.assertEqual(menu.delivery_status, 'Guardado en cola')
        menu.transport(TransportEvent('delivered', 'test-id'))
        self.assertEqual(menu.delivery_status, 'Enviado a central')

    def test_cancel_never_enqueues(self):
        sent = []
        menu = self.open_messages(sent.append)
        menu.handle(Action.ENTER)
        menu.handle(Action.DOWN)
        menu.handle(Action.ENTER)
        self.assertEqual(menu.message_mode, 'choose')
        self.assertEqual(sent, [])

    def test_every_code_can_be_selected_and_returned(self):
        sent = []
        menu = self.open_messages(lambda code: sent.append(code) or code)
        renderer = Renderer()
        for code, _ in MESSAGES:
            for _ in range(2):
                menu.handle(Action.ENTER)
                self.assertEqual(renderer.render(menu).size, (128, 64))
            self.assertEqual(sent[-1], code)
            menu.handle(Action.ENTER)
            menu.handle(Action.DOWN)
        menu.handle(Action.ENTER)
        self.assertIsNone(menu.page)
        self.assertIsNone(menu.message_mode)

    def test_unconfigured_menu_does_not_claim_delivery(self):
        menu = self.open_messages()
        menu.handle(Action.ENTER)
        menu.handle(Action.ENTER)
        self.assertEqual(menu.delivery_status, 'Sin configurar')
        self.assertIsNone(menu.pending_id)

    def test_wrap_keeps_message_selection_visible(self):
        menu = self.open_messages()
        for action in [Action.UP] * 20 + [Action.DOWN] * 20:
            menu.handle(action)
            self.assertLessEqual(menu.message_offset, menu.message_selected)
            self.assertLess(menu.message_selected, menu.message_offset + menu.visible_rows)

    def test_outbox_survives_restart_and_only_removes_acknowledged_message(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'outbox.db'
            outbox = Outbox(path)
            first = outbox.enqueue('HELP')
            second = outbox.enqueue('COLLAPSE')
            reopened = Outbox(path)
            self.assertEqual(reopened.pending, 2)
            self.assertEqual(reopened.first()[0], first)
            reopened.acknowledge('unrelated')
            self.assertEqual(reopened.pending, 2)
            reopened.acknowledge(first)
            self.assertEqual(reopened.first()[0], second)
            payload = reopened.first()[1]
            self.assertEqual(payload['code'], 'COLLAPSE')
            self.assertIn('+00:00', payload['sentAt'])
            with self.assertRaises(ValueError):
                reopened.enqueue('CUSTOM')

    def test_mismatched_ack_keeps_message_in_outbox(self):
        class WrongAck:
            def send(self, frame):
                self.frame = json.loads(frame)
            def recv(self, **kwargs):
                return json.dumps({'type': 'ack', 'clientMessageId': 'wrong', 'messageId': 1})
        with tempfile.TemporaryDirectory() as folder:
            client = DeviceClient({'outbox_path': str(Path(folder) / 'queue.db')}, Queue())
            client.send('HELP')
            with self.assertRaises(ValueError):
                client._exchange(WrongAck(), client.outbox.first()[1])
            self.assertEqual(client.outbox.pending, 1)


if __name__ == '__main__':
    unittest.main()

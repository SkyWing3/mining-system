import json
import queue
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from src.communication.catalog import MESSAGES
from src.communication.client import DeviceClient
from src.communication.outbox import Outbox
from src.config import ConnectionConfig
from src.display.menu import Action, Menu, SendMessage
from src.display.renderer import Renderer
from src.events import NoticeReceived, TransportEvent


class FakeSocket:
    """In-memory server: answers each request through a scripted function and can push notices."""

    def __init__(self, respond):
        self.respond = respond
        self.sent = []
        self.incoming = queue.Queue()
        self.closed = threading.Event()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def send(self, raw):
        frame = json.loads(raw)
        self.sent.append(frame)
        for response in self.respond(frame):
            self.incoming.put(json.dumps(response))

    def push(self, frame):
        self.incoming.put(json.dumps(frame))

    def __iter__(self):
        while True:
            item = self.incoming.get()
            if item is None:
                return
            yield item

    def close(self):
        if not self.closed.is_set():
            self.closed.set()
            self.incoming.put(None)


def acknowledge(frame):
    ack = {"type": "ack", "serverTime": "2026-10-15T12:00:00Z"}
    if frame["type"] == "heartbeat":
        ack["device"] = {"name": "Manilla 01", "minerName": "Javier", "zone": "Norte"}
    if frame["type"] == "message":
        ack.update(clientMessageId=frame["clientMessageId"], messageId=1, duplicate=False)
    return [ack]


class MessageMenuTests(unittest.TestCase):
    def open_messages(self):
        menu = Menu()
        for _ in range(3):
            menu.handle(Action.DOWN)
        menu.handle(Action.ENTER)
        return menu

    def test_selection_does_not_send_until_confirmed(self):
        menu = self.open_messages()
        self.assertEqual(menu.handle(Action.ENTER), ())
        self.assertEqual(menu.message_mode, "confirm")
        self.assertEqual(menu.handle(Action.ENTER), (SendMessage("HELP"),))
        menu.message_queued("test-id")
        self.assertEqual(menu.delivery_status, "Guardado en cola")
        menu.transport(TransportEvent("delivered", "another-id"))
        self.assertEqual(menu.delivery_status, "Guardado en cola")
        menu.transport(TransportEvent("delivered", "test-id"))
        self.assertEqual(menu.delivery_status, "Enviado a central")

    def test_cancel_never_sends(self):
        menu = self.open_messages()
        menu.handle(Action.ENTER)
        menu.handle(Action.DOWN)
        self.assertEqual(menu.handle(Action.ENTER), ())
        self.assertEqual(menu.message_mode, "choose")

    def test_every_code_can_be_selected_and_returned(self):
        menu, renderer = self.open_messages(), Renderer()
        for code, _ in MESSAGES:
            menu.handle(Action.ENTER)
            self.assertEqual(renderer.render(menu).size, (128, 64))
            self.assertEqual(menu.handle(Action.ENTER), (SendMessage(code),))
            menu.handle(Action.ENTER)
            menu.handle(Action.DOWN)
        menu.handle(Action.ENTER)
        self.assertIsNone(menu.page)
        self.assertIsNone(menu.message_mode)

    def test_failure_never_claims_delivery(self):
        menu = self.open_messages()
        menu.handle(Action.ENTER)
        menu.handle(Action.ENTER)
        menu.message_failed("Sin configurar")
        self.assertEqual(menu.delivery_status, "Sin configurar")
        menu.transport(TransportEvent("delivered", None))
        self.assertEqual(menu.delivery_status, "Sin configurar")

    def test_wrap_keeps_message_selection_visible(self):
        menu = self.open_messages()
        for action in [Action.UP] * 20 + [Action.DOWN] * 20:
            menu.handle(action)
            self.assertLessEqual(menu.message_offset, menu.message_selected)
            self.assertLess(menu.message_selected, menu.message_offset + menu.visible_rows)


class OutboxTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / "outbox"

    def tearDown(self):
        self.folder.cleanup()

    def test_outbox_survives_restart_and_only_removes_acknowledged_entry(self):
        first = Outbox(self.path)
        kept = first.enqueue_message("HELP")
        removed = first.enqueue_message("OK")
        reopened = Outbox(self.path)
        self.assertEqual(reopened.first().entry_id, kept)
        reopened.acknowledge(removed)
        reopened.acknowledge("../../not-an-id")
        self.assertEqual([entry.entry_id for entry in reopened.entries()], [kept])

    def test_catalog_and_detail_rules(self):
        outbox = Outbox(self.path)
        with self.assertRaises(ValueError):
            outbox.enqueue_message("CUSTOM")
        with self.assertRaises(ValueError):
            outbox.enqueue_message("HELP", "detail only for alarms")
        message_id = outbox.enqueue_message("CO_ALARM", "CO 245 ppm")
        self.assertEqual(outbox.first().frame["detail"], "CO 245 ppm")
        self.assertEqual(outbox.first().entry_id, message_id)

    def test_notice_confirmations_can_skip_blocked_messages(self):
        outbox = Outbox(self.path)
        outbox.enqueue_message("HELP")
        outbox.enqueue_notice_ack(7, "delivered")
        self.assertEqual(outbox.first().type, "message")
        self.assertEqual(outbox.first(skip_messages=True).type, "notice-ack")
        self.assertTrue(outbox.has_notice_ack(7, "delivered"))
        self.assertFalse(outbox.has_notice_ack(7, "read"))
        self.assertEqual(outbox.pending_messages, 1)

    def test_rejected_entries_are_quarantined(self):
        outbox = Outbox(self.path)
        entry_id = outbox.enqueue_message("OK")
        outbox.reject(entry_id, "Mensaje fuera del catálogo.")
        self.assertEqual(outbox.pending, 0)
        self.assertTrue(any(self.path.joinpath("rejected").glob(f"*-{entry_id}.json")))

    def test_concurrent_writers_preserve_all_entries_and_ack_isolated(self):
        outbox = Outbox(self.path)
        with ThreadPoolExecutor(max_workers=8) as pool:
            ids = list(pool.map(lambda index: Outbox(self.path).enqueue_message(MESSAGES[index % len(MESSAGES)][0]), range(32)))
        self.assertEqual(outbox.pending, 32)
        outbox.acknowledge(ids[5])
        self.assertEqual(outbox.pending, 31)

    def test_failed_storage_never_leaves_partial_entries(self):
        outbox = Outbox(self.path)
        with patch("src.communication.storage.os.replace", side_effect=OSError("disk full")), self.assertRaises(OSError):
            outbox.enqueue_message("HELP")
        self.assertEqual(outbox.pending, 0)
        self.assertEqual(list(self.path.glob(".*.tmp")), [])

    def test_legacy_file_is_preserved_and_rejected_as_queue_directory(self):
        legacy = Path(self.folder.name) / "outbox.json"
        legacy.write_text("[]")
        with self.assertRaises(ValueError):
            Outbox(legacy)
        self.assertEqual(legacy.read_text(), "[]")


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.config = ConnectionConfig(url="ws://central.test/ws/device", api_key="a" * 64, heartbeat_seconds=5,
                                       telemetry_seconds=1, outbox_path=Path(self.folder.name) / "outbox",
                                       voice_outbox_path=Path(self.folder.name) / "voice")
        self.events = queue.Queue()

    def tearDown(self):
        self.folder.cleanup()

    def start(self, respond, telemetry=None):
        sockets = []

        def connect(*_, **__):
            socket = FakeSocket(respond)
            sockets.append(socket)
            return socket

        client = DeviceClient(self.config, self.events, telemetry=telemetry, connect=connect)
        client.start()
        self.addCleanup(client.close)
        return client, sockets

    def wait_for(self, predicate, timeout=5):
        while True:
            event = self.events.get(timeout=timeout)
            if predicate(event):
                return event

    def test_delivers_queue_and_reports_identity(self):
        client, sockets = self.start(acknowledge)
        message_id = client.send("EVACUATE")
        identity = self.wait_for(lambda event: getattr(event, "kind", "") == "identity")
        self.assertEqual(identity.data["name"], "Manilla 01")
        delivered = self.wait_for(lambda event: getattr(event, "kind", "") == "delivered")
        self.assertEqual(delivered.message_id, message_id)
        self.assertEqual(client.outbox.pending, 0)

    def test_mismatched_ack_keeps_message_in_outbox(self):
        def wrong(frame):
            if frame["type"] == "message":
                return [{"type": "ack", "clientMessageId": "someone-else", "messageId": 9}]
            return acknowledge(frame)

        client, _ = self.start(wrong)
        client.send("HELP")
        self.wait_for(lambda event: getattr(event, "kind", "") == "disconnected")
        self.assertEqual(client.outbox.pending, 1)

    def test_invalid_frame_is_rejected_and_unassigned_is_kept(self):
        def errors(frame):
            if frame["type"] == "message" and frame["code"] == "OK":
                return [{"type": "error", "code": "invalid", "message": "Mensaje fuera del catálogo."}]
            if frame["type"] == "message":
                return [{"type": "error", "code": "unassigned", "message": "La manilla necesita un minero asignado."}]
            return acknowledge(frame)

        client, _ = self.start(errors)
        rejected = client.send("OK")
        self.assertEqual(self.wait_for(lambda event: getattr(event, "kind", "") == "rejected").message_id, rejected)
        blocked = client.send("HELP")
        self.assertEqual(self.wait_for(lambda event: getattr(event, "kind", "") == "blocked").message_id, blocked)
        self.assertEqual([entry.entry_id for entry in client.outbox.entries()], [blocked])

    def test_live_telemetry_is_sent_periodically(self):
        readings = {"temperatureC": 24.5, "level": "normal", "simulated": True}
        client, sockets = self.start(acknowledge, telemetry=lambda: readings)
        self.wait_for(lambda event: getattr(event, "kind", "") == "connected")
        deadline = threading.Event()
        deadline.wait(2.5)
        telemetry = [frame for frame in sockets[0].sent if frame["type"] == "telemetry"]
        self.assertGreaterEqual(len(telemetry), 2)
        self.assertEqual(telemetry[0]["temperatureC"], 24.5)

    def test_pushed_notice_is_shown_and_confirmed(self):
        client, sockets = self.start(acknowledge)
        self.wait_for(lambda event: getattr(event, "kind", "") == "connected")
        sockets[0].push({"type": "notice", "noticeId": 12, "code": "EVACUATE", "text": "Evacuar ahora", "severity": "critical"})
        notice = self.wait_for(lambda event: isinstance(event, NoticeReceived))
        self.assertEqual((notice.notice_id, notice.text), (12, "Evacuar ahora"))
        client.acknowledge_notice(12, "read")
        for _ in range(50):
            stages = [frame.get("stage") for frame in sockets[0].sent if frame["type"] == "notice-ack"]
            if stages == ["delivered", "read"]:
                break
            threading.Event().wait(0.05)
        self.assertEqual(stages, ["delivered", "read"])
        self.assertEqual(client.outbox.pending, 0)


if __name__ == "__main__":
    unittest.main()

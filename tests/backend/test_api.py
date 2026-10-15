"""Integration tests against the real API, MySQL and both WebSocket transports.

Run: device/.venv/bin/python -m unittest discover -s tests/backend -v
Build backend first. Rows use an isolated temporary MySQL database; session keys use a temporary directory.
"""
import http.cookiejar
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import io
from contextlib import contextmanager
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue
from websockets.sync.client import connect
from websockets.exceptions import InvalidStatus, ConnectionClosed

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'device'))
sys.path.insert(0, str(ROOT / 'scripts'))
from src.communication.client import DeviceClient
from src.config import ConnectionConfig
from mysql_test_db import create as create_database, drop as drop_database, sql as run_sql

BASE = 'http://127.0.0.1:5081'
WS = 'ws://127.0.0.1:5081'
PASSWORD = 'Integration-Test-2026!'


class Api:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def call(self, path, method='GET', body=None, csrf=True):
        headers = {'Content-Type': 'application/json'}
        if csrf:
            headers['X-Mining-Client'] = 'web'
        request = urllib.request.Request(BASE + '/api' + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            response = self.client.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            text = response.read()
            return response.status, json.loads(text) if text else None

    def raw(self, path):
        try:
            response = self.client.open(urllib.request.Request(BASE + '/api' + path), timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    @property
    def cookie_header(self):
        return '; '.join(f'{cookie.name}={cookie.value}' for cookie in self.cookies)


class BackendTests(unittest.TestCase):
    @classmethod
    def start_server(cls):
        env = {**os.environ, 'Mining__DataDirectory': cls.folder.name, 'Mining__ConnectionString': cls.database['connectionString'], 'Logging__LogLevel__Default': 'Warning', 'ASPNETCORE_ENVIRONMENT': 'Development'}
        cls.server = subprocess.Popen(['dotnet', str(ROOT / 'backend/bin/Debug/net10.0/backend.dll'), '--urls', BASE, '--contentRoot', str(ROOT / 'backend')], env=env, stdout=cls.logs, stderr=cls.logs)
        for _ in range(80):
            try:
                with urllib.request.urlopen(BASE + '/health', timeout=.5) as response:
                    if response.status == 200:
                        return
            except (urllib.error.URLError, TimeoutError):
                time.sleep(.1)
        raise RuntimeError('API did not start. See temporary integration log.')

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(prefix='mining-api-tests-')
        cls.database = create_database('api')
        cls.addClassCleanup(drop_database, cls.database['name'])
        cls.logs = open(Path(cls.folder.name) / 'server.log', 'w')
        cls.start_server()
        cls.admin = Api()
        status, cls.admin_user = cls.admin.call('/auth/setup', 'POST', {'name': 'Test Administrator', 'email': 'admin@test.invalid', 'password': PASSWORD})
        if status != 200:
            cls.tearDownClass()
            raise RuntimeError(f'Setup failed: {status}')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.logs.close()
        cls.folder.cleanup()

    def create_user(self, role='Miner'):
        suffix = uuid.uuid4().hex[:12]
        status, user = self.admin.call('/users', 'POST', {'name': 'Persona ' + suffix, 'email': f'{suffix}@test.invalid', 'password': PASSWORD, 'role': role, 'active': True})
        self.assertEqual(status, 200, user)
        self.assertNotIn('passwordHash', user)
        return user

    def create_device(self, miner=None):
        miner = miner or self.create_user()
        status, result = self.admin.call('/devices', 'POST', {'name': 'Manilla ' + uuid.uuid4().hex[:10], 'zone': 'Galería norte', 'userId': miner['id'], 'active': True})
        self.assertEqual(status, 200, result)
        self.assertEqual(len(result['apiKey']), 64)
        return result['device'], result['apiKey']

    def frame(self, code='HELP', message_id=None):
        return {'type': 'message', 'clientMessageId': message_id or uuid.uuid4().hex, 'code': code, 'sentAt': datetime.now(timezone.utc).isoformat()}

    def socket(self, key):
        return connect(WS + '/ws/device', additional_headers={'X-Device-Key': key}, proxy=None, open_timeout=3, close_timeout=1)

    @contextmanager
    def browser(self):
        with connect(WS + '/hubs/mining', additional_headers={'Cookie': self.admin.cookie_header}, origin='http://localhost:5173', proxy=None, close_timeout=1) as socket:
            socket.send('{"protocol":"json","version":1}\x1e')
            self.assertIn('{}', socket.recv(timeout=3))
            yield socket

    def events_from(self, browser, target, count=1, timeout=3):
        found = []
        deadline = time.monotonic() + timeout
        while len(found) < count and time.monotonic() < deadline:
            try:
                payload = browser.recv(timeout=max(0.05, deadline - time.monotonic()))
            except TimeoutError:
                break
            for part in payload.split('\x1e'):
                if part:
                    message = json.loads(part)
                    if message.get('target') == target:
                        found.append(message['arguments'][0])
        return found

    @staticmethod
    def wav(seconds=1.0, rate=16000):
        output = io.BytesIO()
        with wave.open(output, 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(rate)
            audio.writeframes(b'\x10\x00' * int(seconds * rate))
        return output.getvalue()

    def upload_voice(self, key, body, voice_id=None, content_type='audio/wav'):
        headers = {'X-Device-Key': key, 'X-Client-Message-Id': voice_id or uuid.uuid4().hex,
                   'X-Recorded-At': datetime.now(timezone.utc).isoformat(), 'Content-Type': content_type}
        request = urllib.request.Request(BASE + '/api/device/voice', data=body, headers=headers, method='POST')
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            text = response.read()
            return response.status, json.loads(text) if text else None

    def exchange(self, socket, payload):
        socket.send(json.dumps(payload))
        return json.loads(socket.recv(timeout=3))

    def test_authentication_and_csrf_required(self):
        anonymous = Api()
        self.assertEqual(anonymous.call('/overview')[0], 401)
        self.assertEqual(anonymous.call('/users')[0], 401)
        self.assertEqual(anonymous.call('/auth/login', 'POST', {'email': 'admin@test.invalid', 'password': PASSWORD}, csrf=False)[0], 403)
        self.assertEqual(anonymous.call('/auth/login', 'POST', {'email': 'admin@test.invalid', 'password': 'wrong-password'})[0], 401)
        self.assertEqual(self.admin.call('/auth/setup', 'POST', {'name': 'Another Admin', 'email': 'other@test.invalid', 'password': PASSWORD})[0], 409)

    def test_contract_and_catalog_match_the_oled(self):
        from src.communication.catalog import AUTOMATIC_MESSAGES, MESSAGES, NOTICES
        with urllib.request.urlopen(BASE + '/openapi/v1.json', timeout=5) as response:
            contract = json.load(response)
        for path in ('/api/auth/login', '/api/notices', '/api/voice', '/api/device/voice'):
            self.assertIn(path, contract['paths'])
        _, overview = self.admin.call('/overview')
        self.assertEqual({x['code'] for x in overview['catalog'] if not x['automatic']}, {code for code, _ in MESSAGES})
        self.assertEqual({x['code'] for x in overview['catalog'] if x['automatic']}, set(AUTOMATIC_MESSAGES))
        self.assertEqual({x['code']: x['text'] for x in overview['noticeCatalog']}, NOTICES)
        self.assertTrue(all(len(text) <= 20 for text in NOTICES.values()))
        self.assertTrue(overview['serverTime'].endswith('Z'))
        for counter in ('liveDanger', 'pendingVoice', 'pendingNotices'):
            self.assertIn(counter, overview)

    def test_cookie_and_account_roles(self):
        supervisor = self.create_user('Supervisor')
        client = Api()
        self.assertEqual(client.call('/auth/login', 'POST', {'email': supervisor['email'], 'password': PASSWORD})[0], 200)
        self.assertEqual(client.call('/overview')[0], 200)
        self.assertEqual(client.call('/users')[0], 403)
        self.assertEqual(client.call('/users', 'POST', {'name': 'Illegal User', 'email': 'illegal@test.invalid', 'role': 'Admin', 'password': PASSWORD})[0], 403)
        miner = self.create_user()
        self.assertEqual(Api().call('/auth/login', 'POST', {'email': miner['email'], 'password': PASSWORD})[0], 403)

    def test_last_administrator_cannot_be_removed(self):
        body = {**self.admin_user, 'role': 'Supervisor'}
        self.assertEqual(self.admin.call('/users/' + body['id'], 'PUT', body)[0], 400)
        body['role'] = 'Admin'; body['active'] = False
        self.assertEqual(self.admin.call('/users/' + body['id'], 'PUT', body)[0], 400)

    def test_user_validation_and_duplicates(self):
        user = self.create_user()
        self.assertEqual(self.admin.call('/users', 'POST', {**user, 'password': PASSWORD})[0], 409)
        self.assertEqual(self.admin.call('/users', 'POST', {**user, 'email': 'different@test.invalid', 'role': 'Unknown', 'password': PASSWORD})[0], 400)
        self.assertEqual(self.admin.call('/users', 'POST', {**user, 'email': 'short@test.invalid', 'password': 'short'})[0], 400)

    def test_one_active_device_per_miner(self):
        miner = self.create_user()
        device, _ = self.create_device(miner)
        self.assertEqual(self.admin.call('/devices', 'POST', {'name': 'Other device', 'zone': 'Sector sur', 'userId': miner['id']})[0], 409)
        self.assertEqual(self.admin.call('/users/' + miner['id'], 'PUT', {**miner, 'active': False})[0], 400)
        self.assertEqual(self.admin.call('/devices/' + device['id'], 'PUT', {**device, 'userId': 'does-not-exist'})[0], 400)

    def test_message_delivered_to_browser_websocket_immediately(self):
        device, key = self.create_device()
        with connect(WS + '/hubs/mining', additional_headers={'Cookie': self.admin.cookie_header}, origin='http://localhost:5173', proxy=None, close_timeout=1) as browser:
            browser.send('{"protocol":"json","version":1}\x1e')
            self.assertIn('{}', browser.recv(timeout=3))
            with self.socket(key) as wearable:
                started = time.monotonic()
                ack = self.exchange(wearable, self.frame('COLLAPSE'))
                self.assertEqual(ack['type'], 'ack')
                messages = []
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    payload = browser.recv(timeout=3)
                    messages.extend(json.loads(part) for part in payload.split('\x1e') if part)
                    received = next((x for x in messages if x.get('target') == 'MessageReceived'), None)
                    if received:
                        break
                self.assertIsNotNone(received)
                self.assertEqual(received['arguments'][0]['deviceId'], device['id'])
                self.assertEqual(received['arguments'][0]['text'], 'Hay derrumbe')
                self.assertLess(time.monotonic() - started, 2)

    def test_idempotent_retry_and_catalog_validation(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            payload = self.frame()
            first = self.exchange(socket, payload)
            second = self.exchange(socket, payload)
            self.assertEqual(first['messageId'], second['messageId'])
            self.assertTrue(second['duplicate'])
            self.assertEqual(self.exchange(socket, self.frame('CUSTOM'))['type'], 'error')
            self.assertEqual(self.exchange(socket, {**payload, 'code': 'OK'})['type'], 'error')
        status, messages = self.admin.call('/messages?deviceId=' + device['id'])
        self.assertEqual(status, 200)
        self.assertEqual(messages['total'], 1)

    def test_telemetry_validation_and_presence(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'batteryPercent': 101})['type'], 'error')
            self.assertEqual(self.exchange(socket, {'type': 'telemetry'})['type'], 'error')
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'temperatureC': 29.4, 'batteryPercent': 74})['type'], 'ack')
        _, readings = self.admin.call('/devices/' + device['id'] + '/telemetry')
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0]['temperatureC'], 29.4)
        self.assertIsNone(readings[0]['gasPpm'])
        _, devices = self.admin.call('/devices')
        row = next(x for x in devices if x['id'] == device['id'])
        self.assertTrue(row['online'])
        self.assertEqual(row['reading']['batteryPercent'], 74)
        self.assertNotIn('keyHash', row)

    def test_telemetry_keeps_wearer_after_reassignment(self):
        first, second = self.create_user(), self.create_user()
        device, key = self.create_device(first)
        with self.socket(key) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'gasPpm': 35})['type'], 'ack')
        status, result = self.admin.call('/devices/' + device['id'], 'PUT', {'name': device['name'], 'zone': 'Galería sur', 'userId': second['id'], 'active': True})
        self.assertEqual(status, 200, result)
        with self.socket(key) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'gasPpm': 12})['type'], 'ack')
        _, readings = self.admin.call('/devices/' + device['id'] + '/telemetry')
        latest, earlier = readings
        self.assertEqual((earlier['minerName'], earlier['zone'], earlier['gasPpm']), (first['name'], 'Galería norte', 35))
        self.assertEqual((latest['minerName'], latest['zone'], latest['gasPpm']), (second['name'], 'Galería sur', 12))

    def test_database_policies_protect_history(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'gasPpm': 20})['type'], 'ack')
            self.assertEqual(self.exchange(socket, self.frame('HELP'))['type'], 'ack')
        database = '`' + self.database['name'] + '`'
        rejected = {
            f"DELETE FROM {database}.Readings;": 'solo admiten inserciones',
            f"UPDATE {database}.Readings SET GasPpm = 0;": 'solo admiten inserciones',
            f"UPDATE {database}.Events SET Actor = 'x';": 'solo admite inserciones',
            f"DELETE FROM {database}.Messages;": 'no se eliminan',
            f"UPDATE {database}.Messages SET Code = 'OK';": 'una sola vez',
            f"DELETE FROM {database}.Devices;": 'no se eliminan',
            f"INSERT INTO {database}.Readings (DeviceId, MinerName, DeviceName, Zone, BatteryPercent, ReceivedAt) VALUES ('{device['id']}', '', '', '', 101, NOW(6));": 'CK_Readings_Battery',
            f"UPDATE {database}.Users SET Role = 'Root';": 'CK_Users_Role',
        }
        for statement, error in rejected.items():
            with self.subTest(statement=statement):
                with self.assertRaises(RuntimeError) as failure:
                    run_sql(statement)
                self.assertIn(error, str(failure.exception))
        self.assertEqual(run_sql(f"SELECT COUNT(*) FROM {database}.Readings WHERE DeviceId = '{device['id']}';").strip(), '1')

    def test_partial_readings_satisfy_the_measurement_constraint(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'gasVoltage': 0.41, 'level': 'normal'})['type'], 'ack')
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'objectTemperatureC': 61.5, 'level': 'caution'})['type'], 'ack')
        _, readings = self.admin.call('/devices/' + device['id'] + '/telemetry')
        self.assertEqual([(x['gasVoltage'], x['objectTemperatureC']) for x in readings], [(None, 61.5), (0.41, None)])
        self.assertEqual({x['deviceName'] for x in readings}, {device['name']})

    def test_database_policies_protect_voice_notices_and_alarm_detail(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.assertEqual(self.exchange(socket, {**self.frame('CO_ALARM'), 'detail': 'CO 210 ppm'})['type'], 'ack')
        self.assertEqual(self.upload_voice(key, self.wav())[0], 201)
        _, notices = self.admin.call('/notices', 'POST', {'code': 'REPORT', 'deviceIds': [device['id']]})
        database = '`' + self.database['name'] + '`'
        notice = notices[0]['id']
        rejected = {
            f"UPDATE {database}.Messages SET Detail = 'CO 0 ppm' WHERE DeviceId = '{device['id']}';": 'una sola vez',
            f"DELETE FROM {database}.VoiceMessages WHERE DeviceId = '{device['id']}';": 'no se eliminan',
            f"UPDATE {database}.VoiceMessages SET DurationMs = 1 WHERE DeviceId = '{device['id']}';": 'una sola vez',
            f"DELETE FROM {database}.Notices WHERE Id = {notice};": 'no se eliminan',
            f"UPDATE {database}.Notices SET Code = 'EVACUATE' WHERE Id = {notice};": 'una sola vez',
            f"UPDATE {database}.Notices SET ReadAt = NOW(6) WHERE Id = {notice};": 'CK_Notices_ReadAfterDelivery',
            f"UPDATE {database}.Readings SET Level = 'danger';": 'solo admiten inserciones',
        }
        for statement, error in rejected.items():
            with self.subTest(statement=statement):
                with self.assertRaises(RuntimeError) as failure:
                    run_sql(statement)
                self.assertIn(error, str(failure.exception))
        # The API's own updates are exactly what the policies allow.
        with self.socket(key) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'heartbeat'})['type'], 'ack')
            self.assertEqual(json.loads(socket.recv(timeout=3))['noticeId'], notice)
            self.assertEqual(self.exchange(socket, {'type': 'notice-ack', 'noticeId': notice, 'stage': 'read'})['type'], 'ack')
        _, page = self.admin.call('/notices?deviceId=' + device['id'])
        self.assertEqual(page['items'][0]['status'], 'read')
        _, voices = self.admin.call('/voice?deviceId=' + device['id'])
        self.assertEqual(self.admin.call(f"/voice/{voices['items'][0]['id']}/review", 'POST')[0], 200)

    def test_invalid_and_rotated_credentials_rejected(self):
        with self.assertRaises(InvalidStatus):
            self.socket('a' * 64)
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.exchange(socket, {'type': 'heartbeat'})
            status, result = self.admin.call('/devices/' + device['id'] + '/rotate-key', 'POST')
            self.assertEqual(status, 200)
            with self.assertRaises(ConnectionClosed):
                socket.recv(timeout=3)
            self.assertEqual(socket.close_code, 1008)
        with self.assertRaises(InvalidStatus):
            self.socket(key)
        with self.socket(result['apiKey']) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'heartbeat'})['type'], 'ack')

    def test_historical_identity_survives_reassignment(self):
        original = self.create_user()
        device, key = self.create_device(original)
        with self.socket(key) as socket:
            self.exchange(socket, self.frame('OK'))
        replacement = self.create_user()
        self.assertEqual(self.admin.call('/devices/' + device['id'], 'PUT', {**device, 'userId': replacement['id'], 'zone': 'Nueva zona'})[0], 200)
        _, result = self.admin.call('/messages?deviceId=' + device['id'])
        self.assertEqual(result['items'][0]['minerName'], original['name'])
        self.assertEqual(result['items'][0]['zone'], 'Galería norte')

    def test_review_is_internal_and_idempotent(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            ack = self.exchange(socket, self.frame())
            path = f'/messages/{ack["messageId"]}/review'
            self.assertEqual(Api().call(path, 'POST')[0], 401)
            status, reviewed = self.admin.call(path, 'POST')
            self.assertEqual(status, 200)
            self.assertEqual(reviewed['reviewedBy'], self.admin_user['name'])
            self.assertEqual(self.admin.call(path, 'POST')[1]['reviewedAt'], reviewed['reviewedAt'])
            with self.assertRaises(TimeoutError):
                socket.recv(timeout=.2)
        _, result = self.admin.call('/messages?pending=true&severity=critical&deviceId=' + device['id'])
        self.assertEqual(result['total'], 0)

    def test_local_client_delivers_durable_queue(self):
        device, key = self.create_device()
        events = Queue()
        folder = Path(self.folder.name) / uuid.uuid4().hex
        config = ConnectionConfig(url=WS + '/ws/device', api_key=key, heartbeat_seconds=5, telemetry_seconds=1,
                                  outbox_path=folder / 'outbox', voice_outbox_path=folder / 'voice')
        client = DeviceClient(config, events)
        message_id = client.send('EVACUATE')
        self.assertEqual(client.outbox.pending, 1)
        client.start()
        try:
            delivered = None
            for _ in range(5):
                event = events.get(timeout=5)
                if event.kind == 'delivered':
                    delivered = event
                    break
            self.assertIsNotNone(delivered)
            self.assertEqual(delivered.message_id, message_id)
            self.assertEqual(client.outbox.pending, 0)
            _, result = self.admin.call('/messages?deviceId=' + device['id'])
            self.assertEqual(result['total'], 1)
        finally:
            client.close()

    def test_revoking_account_ends_session(self):
        user = self.create_user('Supervisor')
        client = Api()
        self.assertEqual(client.call('/auth/login', 'POST', {'email': user['email'], 'password': PASSWORD})[0], 200)
        self.assertEqual(self.admin.call('/users/' + user['id'], 'PUT', {**user, 'active': False})[0], 200)
        self.assertEqual(client.call('/overview')[0], 401)

    def test_live_telemetry_is_broadcast_and_storage_is_throttled(self):
        device, key = self.create_device()
        with self.browser() as browser:
            with self.socket(key) as socket:
                frames = [
                    {'type': 'telemetry', 'temperatureC': 24.5, 'objectTemperatureC': 26.0, 'gasVoltage': 0.41, 'level': 'normal', 'simulated': True},
                    {'type': 'telemetry', 'temperatureC': 24.6, 'gasVoltage': 0.42, 'level': 'normal', 'simulated': True},
                    {'type': 'telemetry', 'temperatureC': 33.0, 'gasPpm': 48, 'level': 'caution'},
                ]
                for frame in frames:
                    self.assertEqual(self.exchange(socket, frame)['type'], 'ack')
                self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'temperatureC': 20, 'level': 'panic'})['type'], 'error')
                self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'gasVoltage': -1})['code'], 'invalid')
            live = [event for event in self.events_from(browser, 'TelemetryReceived', 3) if event['deviceId'] == device['id']]
        self.assertEqual([event['reading']['temperatureC'] for event in live], [24.5, 24.6, 33.0])
        self.assertEqual(live[0]['reading']['objectTemperatureC'], 26.0)
        self.assertTrue(live[0]['reading']['simulated'])
        self.assertIsNone(live[1]['reading']['id'])
        _, stored = self.admin.call('/devices/' + device['id'] + '/telemetry')
        # First reading and the level change are stored; the repeat within 10 s is live only.
        self.assertEqual([row['level'] for row in stored], ['caution', 'normal'])
        _, devices = self.admin.call('/devices')
        row = next(x for x in devices if x['id'] == device['id'])
        self.assertEqual(row['reading']['temperatureC'], 33.0)
        self.assertEqual(row['reading']['level'], 'caution')
        since = stored[0]['receivedAt']
        _, recent = self.admin.call('/devices/' + device['id'] + '/telemetry?since=' + urllib.parse.quote(since) + '&limit=5')
        self.assertEqual(len(recent), 1)

    def test_automatic_alarm_keeps_detail_and_counts_as_alert(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            ack = self.exchange(socket, {**self.frame('CO_ALARM'), 'detail': 'CO 245 ppm'})
            self.assertEqual(ack['type'], 'ack')
            self.assertEqual(self.exchange(socket, {**self.frame('HELP'), 'detail': 'texto libre'})['code'], 'invalid')
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'gasPpm': 245, 'level': 'danger'})['type'], 'ack')
        _, result = self.admin.call('/messages?severity=critical&pending=true&deviceId=' + device['id'])
        self.assertEqual(result['items'][0]['text'], 'Alarma de CO')
        self.assertEqual(result['items'][0]['detail'], 'CO 245 ppm')
        _, overview = self.admin.call('/overview')
        self.assertGreaterEqual(overview['liveDanger'], 1)
        self.assertGreaterEqual(overview['pendingAlerts'], 1)

    def test_search_ignores_accents_and_case(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.exchange(socket, self.frame('INJURY'))
        for term in ('galeria', 'GALERÍA', 'companero'):
            _, result = self.admin.call('/messages?deviceId=' + device['id'] + '&search=' + urllib.parse.quote(term))
            self.assertEqual(result['total'], 1, term)

    def test_unassigned_device_keeps_messages_pending(self):
        status, result = self.admin.call('/devices', 'POST', {'name': 'Libre ' + uuid.uuid4().hex[:8], 'zone': 'Sur', 'userId': None, 'active': True})
        self.assertEqual(status, 200)
        with self.socket(result['apiKey']) as socket:
            ack = self.exchange(socket, {'type': 'heartbeat'})
            self.assertEqual(ack['device'], {'name': result['device']['name'], 'zone': 'Sur'})
            self.assertEqual(self.exchange(socket, self.frame())['code'], 'unassigned')
            self.assertEqual(self.exchange(socket, {'type': 'bogus'})['code'], 'invalid')
            self.assertEqual(self.exchange(socket, {'type': 'telemetry', 'temperatureC': 22})['type'], 'ack')

    def test_notices_reach_connected_and_reconnecting_devices(self):
        device, key = self.create_device()
        other, other_key = self.create_device()
        with self.browser() as browser:
            with self.socket(key) as socket:
                self.assertEqual(self.exchange(socket, {'type': 'heartbeat'})['device']['name'], device['name'])
                self.assertEqual(self.admin.call('/notices', 'POST', {'code': 'UNKNOWN', 'deviceIds': [device['id']]})[0], 400)
                self.assertEqual(self.admin.call('/notices', 'POST', {'code': 'EVACUATE', 'deviceIds': []})[0], 400)
                status, created = self.admin.call('/notices', 'POST', {'code': 'EVACUATE', 'deviceIds': [device['id'], other['id']]})
                self.assertEqual(status, 200, created)
                self.assertEqual({x['status'] for x in created}, {'pending'})
                pushed = json.loads(socket.recv(timeout=3))
                self.assertEqual((pushed['type'], pushed['code'], pushed['text'], pushed['severity']), ('notice', 'EVACUATE', 'Evacuar ahora', 'critical'))
                notice_id = pushed['noticeId']
                ack = self.exchange(socket, {'type': 'notice-ack', 'noticeId': notice_id, 'stage': 'delivered'})
                self.assertEqual((ack['type'], ack['noticeId']), ('ack', notice_id))
                self.assertEqual(self.exchange(socket, {'type': 'notice-ack', 'noticeId': notice_id, 'stage': 'read'})['type'], 'ack')
                self.assertEqual(self.exchange(socket, {'type': 'notice-ack', 'noticeId': 999999999, 'stage': 'read'})['type'], 'error')
            updates = self.events_from(browser, 'NoticeUpdated', 4)
        self.assertIn('read', {x['status'] for x in updates if x['id'] == notice_id})
        _, page = self.admin.call('/notices?deviceId=' + device['id'])
        self.assertEqual(page['items'][0]['status'], 'read')
        self.assertIsNotNone(page['items'][0]['readAt'])
        # The offline device receives the pending notice after its first frame.
        with self.socket(other_key) as socket:
            self.assertEqual(self.exchange(socket, {'type': 'heartbeat'})['type'], 'ack')
            pending = json.loads(socket.recv(timeout=3))
            self.assertEqual((pending['type'], pending['code']), ('notice', 'EVACUATE'))
        _, events = self.admin.call('/events')
        self.assertTrue(any('Evacuar ahora' in event['description'] for event in events))

    def test_voice_upload_is_validated_idempotent_and_playable(self):
        device, key = self.create_device()
        audio = self.wav(1.5)
        voice_id = uuid.uuid4().hex
        with self.browser() as browser:
            status, created = self.upload_voice(key, audio, voice_id)
            self.assertEqual(status, 201, created)
            self.assertFalse(created['duplicate'])
            self.assertEqual(created['voice']['durationMs'], 1500)
            received = self.events_from(browser, 'VoiceMessageReceived')
        self.assertEqual(received[0]['id'], created['voice']['id'])
        status, again = self.upload_voice(key, audio, voice_id)
        self.assertEqual((status, again['duplicate'], again['voice']['id']), (200, True, created['voice']['id']))
        self.assertEqual(self.upload_voice('f' * 64, audio)[0], 401)
        self.assertEqual(self.upload_voice(key, b'not a wav file at all, just text' * 4)[0], 400)
        self.assertEqual(self.upload_voice(key, self.wav(0.1))[0], 400)
        self.assertEqual(self.upload_voice(key, audio, content_type='application/octet-stream')[0], 415)
        self.assertEqual(self.upload_voice(key, audio, voice_id='../../etc/passwd')[0], 400)
        voice = created['voice']
        status, headers, body = self.admin.raw(f"/voice/{voice['id']}/audio")
        self.assertEqual((status, headers['Content-Type'], body), (200, 'audio/wav', audio))
        self.assertEqual(Api().raw(f"/voice/{voice['id']}/audio")[0], 401)
        _, listing = self.admin.call('/voice?pending=true&deviceId=' + device['id'])
        self.assertEqual(listing['total'], 1)
        status, reviewed = self.admin.call(f"/voice/{voice['id']}/review", 'POST')
        self.assertEqual((status, reviewed['reviewedBy']), (200, self.admin_user['name']))
        self.assertEqual(self.admin.call('/voice?pending=true&deviceId=' + device['id'])[1]['total'], 0)

    def test_voice_requires_an_assigned_miner(self):
        _, result = self.admin.call('/devices', 'POST', {'name': 'Sin minero ' + uuid.uuid4().hex[:8], 'zone': 'Sur', 'userId': None, 'active': True})
        self.assertEqual(self.upload_voice(result['apiKey'], self.wav())[0], 409)

    def test_disabling_a_device_closes_its_socket(self):
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.exchange(socket, {'type': 'heartbeat'})
            body = {'name': device['name'], 'zone': device['zone'], 'userId': device['userId'], 'active': False}
            self.assertEqual(self.admin.call('/devices/' + device['id'], 'PUT', body)[0], 200)
            with self.assertRaises(ConnectionClosed):
                socket.recv(timeout=3)
        with self.assertRaises(InvalidStatus):
            self.socket(key)

    def test_renaming_a_user_keeps_their_session(self):
        user = self.create_user('Supervisor')
        client = Api()
        self.assertEqual(client.call('/auth/login', 'POST', {'email': user['email'], 'password': PASSWORD})[0], 200)
        self.assertEqual(self.admin.call('/users/' + user['id'], 'PUT', {**user, 'name': 'Nombre Nuevo'})[0], 200)
        self.assertEqual(client.call('/auth/me')[1]['name'], 'Nombre Nuevo')
        self.assertEqual(self.admin.call('/users/' + user['id'], 'PUT', {**user, 'role': 'Admin'})[0], 200)
        self.assertEqual(client.call('/overview')[0], 401)

    def test_zz_data_and_cookie_keys_survive_server_restart(self):
        _, before = self.admin.call('/overview')
        self.server.terminate(); self.server.wait(timeout=10)
        type(self).start_server()
        self.assertEqual(self.admin.call('/auth/status')[1]['setupRequired'], False)
        self.assertEqual(self.admin.call('/auth/me')[0], 200)
        _, after = self.admin.call('/overview')
        self.assertEqual(before['messagesToday'], after['messagesToday'])
        self.assertEqual(before['activeMiners'], after['activeMiners'])

    def test_zy_login_attempts_are_rate_limited(self):
        client = Api()
        statuses = [client.call('/auth/login', 'POST', {'email': 'admin@test.invalid', 'password': 'wrong-password'})[0] for _ in range(13)]
        self.assertIn(429, statuses)


if __name__ == '__main__':
    unittest.main()

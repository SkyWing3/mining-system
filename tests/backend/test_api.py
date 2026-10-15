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
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue
from websockets.sync.client import connect
from websockets.exceptions import InvalidStatus, ConnectionClosed

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'device'))
sys.path.insert(0, str(ROOT / 'scripts'))
from src.communication.client import DeviceClient
from mysql_test_db import create as create_database, drop as drop_database

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
        from src.communication.catalog import MESSAGES
        with urllib.request.urlopen(BASE + '/openapi/v1.json', timeout=5) as response:
            contract = json.load(response)
        self.assertIn('/api/auth/login', contract['paths'])
        _, overview = self.admin.call('/overview')
        self.assertEqual({x['code'] for x in overview['catalog']}, {code for code, _ in MESSAGES})
        self.assertTrue(overview['serverTime'].endswith('Z'))

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

    def test_invalid_and_rotated_credentials_rejected(self):
        with self.assertRaises(InvalidStatus):
            self.socket('a' * 64)
        device, key = self.create_device()
        with self.socket(key) as socket:
            self.exchange(socket, {'type': 'heartbeat'})
            status, result = self.admin.call('/devices/' + device['id'] + '/rotate-key', 'POST')
            self.assertEqual(status, 200)
            socket.send('{"type":"heartbeat"}')
            with self.assertRaises(ConnectionClosed):
                socket.recv(timeout=3)
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
        client = DeviceClient({'url': WS + '/ws/device', 'api_key': key, 'heartbeat_seconds': 5, 'outbox_path': str(Path(self.folder.name) / 'device-outbox')}, events)
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

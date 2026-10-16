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

    def seed_history(self):
        """Readings and messages at fixed past instants, isolated from rows that other tests create now."""
        suffix = uuid.uuid4().hex[:8]
        first, second = self.create_user(), self.create_user()
        devices = []
        for miner, zone in ((first, 'Zona A ' + suffix), (second, 'Zona B ' + suffix)):
            status, result = self.admin.call('/devices', 'POST', {'name': 'Manilla ' + uuid.uuid4().hex[:10], 'zone': zone, 'userId': miner['id'], 'active': True})
            self.assertEqual(status, 200, result)
            devices.append((miner, result['device']))
        database = '`' + self.database['name'] + '`'
        def reading(index, at, temperature, gas, battery):
            miner, device = devices[index]
            values = ', '.join('NULL' if value is None else str(value) for value in (temperature, gas, battery))
            return f"('{device['id']}', '{miner['name']}', '{device['name']}', '{device['zone']}', {values}, '{at}')"
        rows = [
            reading(0, '2026-01-05 10:15:00', 20, 100, 90),
            reading(0, '2026-01-05 10:45:00', 24, None, 80),
            reading(0, '2026-01-05 13:30:00', 30, 300, None),
            reading(1, '2026-01-05 10:20:00', 40, 50, 70),
            reading(1, '2026-01-06 05:00:00', 10, None, 60),
        ]
        run_sql(f"INSERT INTO {database}.Readings (DeviceId, MinerName, DeviceName, Zone, TemperatureC, GasPpm, BatteryPercent, ReceivedAt) VALUES {', '.join(rows)};")
        def message(index, code, at, reviewed=False):
            miner, device = devices[index]
            review = f"'{at}', 'Prueba'" if reviewed else 'NULL, NULL'
            return f"('{device['id']}', '{uuid.uuid4().hex}', '{code}', '{miner['name']}', '{device['name']}', '{device['zone']}', '{at}', '{at}', {review})"
        messages = [
            message(0, 'HELP', '2026-01-05 12:00:00'),
            message(0, 'GAS', '2026-01-05 15:00:00', reviewed=True),
            # 03:00 UTC on 6 January is still 5 January in Bolivia (UTC-4).
            message(0, 'SUPPLIES', '2026-01-06 03:00:00'),
            message(1, 'OK', '2026-01-06 05:00:00'),
            message(1, 'EXIT', '2026-01-06 06:00:00'),
        ]
        run_sql(f"INSERT INTO {database}.Messages (DeviceId, ClientMessageId, Code, MinerName, DeviceName, Zone, SentAt, ReceivedAt, ReviewedAt, ReviewedBy) VALUES {', '.join(messages)};")
        return devices

    def analytics(self, path, client=None, **params):
        return (client or self.admin).call('/analytics/' + path + '?' + urllib.parse.urlencode(params))

    def test_analytics_requires_session(self):
        anonymous = Api()
        for path in ('readings', 'messages', 'options'):
            with self.subTest(path=path):
                self.assertEqual(self.analytics(path, anonymous)[0], 401)
        supervisor = self.create_user('Supervisor')
        client = Api()
        self.assertEqual(client.call('/auth/login', 'POST', {'email': supervisor['email'], 'password': PASSWORD})[0], 200)
        self.assertEqual(self.analytics('readings', client)[0], 200)
        self.assertEqual(self.analytics('messages', client)[0], 200)

    def test_analytics_validation(self):
        cases = [
            ({'from': '2026-01-05T10:00:00Z', 'to': '2026-01-05T10:00:00Z'}, 'anterior a la fecha final'),
            ({'from': '2026-01-06T00:00:00Z', 'to': '2026-01-05T00:00:00Z'}, 'anterior a la fecha final'),
            ({'from': '2025-01-01T00:00:00Z', 'to': '2025-04-02T00:00:01Z'}, 'no puede superar 90 días'),
            ({'from': 'ayer', 'to': '2026-01-05T00:00:00Z'}, 'fecha inicial no es válida'),
            ({'from': '2026-01-01T00:00:00Z', 'to': '31/01/2026'}, 'fecha final no es válida'),
            ({'from': '2026-01-01T00:00:00Z', 'to': '2026-01-02T00:00:00Z', 'metric': 'humidity'}, 'Métrica no válida'),
            ({'from': '2026-01-01T00:00:00Z', 'to': '2026-01-02T00:00:00Z', 'bucket': 'week'}, 'Intervalo no válido'),
            ({'from': '2026-01-01T00:00:00Z', 'to': '2026-01-16T00:00:00Z', 'bucket': 'hour'}, 'no puede superar 14 días'),
            ({'from': '2026-01-01T00:00:00Z', 'to': '2026-01-02T00:00:00Z', 'miner': 'x' * 101}, '100 caracteres'),
        ]
        for params, error in cases:
            with self.subTest(params=params):
                status, body = self.analytics('readings', **params)
                self.assertEqual(status, 400, body)
                self.assertIn(error, body['message'])
        status, body = self.analytics('messages', **{'from': '2025-01-01T00:00:00Z', 'to': '2025-06-01T00:00:00Z'})
        self.assertEqual((status, 'no puede superar 90 días' in body['message']), (400, True))
        # Exactly 90 days is accepted; defaults cover the last seven days.
        self.assertEqual(self.analytics('readings', **{'from': '2025-01-01T00:00:00Z', 'to': '2025-04-01T00:00:00Z'})[0], 200)
        status, body = self.analytics('readings')
        self.assertEqual((status, body['bucket'], body['metric']), (200, 'day', 'temperature'))

    def test_analytics_aggregates_readings_in_mysql(self):
        (first, device_a), (second, device_b) = self.seed_history()
        window = {'from': '2026-01-05T10:00:00Z', 'to': '2026-01-05T14:00:00Z'}
        status, body = self.analytics('readings', **window, metric='temperature', bucket='hour')
        self.assertEqual(status, 200, body)
        self.assertEqual((body['unit'], body['bucket']), ('°C', 'hour'))
        self.assertEqual(body['summary'], {'readings': 4, 'average': 28.5, 'maximum': 40, 'minimum': 20})
        self.assertEqual([x['start'] for x in body['series']], ['2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z', '2026-01-05T13:00:00Z'])
        self.assertEqual([(x['count'], x['average'], x['maximum']) for x in body['series']], [(3, 28, 40), (0, None, None), (0, None, None), (1, 30, 30)])
        self.assertEqual([(x['miner'], x['count'], x['average'], x['maximum']) for x in body['miners'] if x['miner'] in (first['name'], second['name'])],
                         sorted([(first['name'], 3, 24.67, 30), (second['name'], 1, 40, 40)]))

        # The miner filter narrows summary and series; the comparison keeps every miner as a selector.
        _, mine = self.analytics('readings', **window, metric='temperature', bucket='hour', miner=first['name'])
        self.assertEqual(mine['summary'], {'readings': 3, 'average': 24.67, 'maximum': 30, 'minimum': 20})
        self.assertEqual((mine['series'][0]['count'], mine['series'][0]['average']), (2, 22))
        self.assertEqual({x['miner'] for x in mine['miners']}, {first['name'], second['name']})

        # Missing values are absence, not zero: the gas average ignores the NULL reading.
        _, gas = self.analytics('readings', **window, metric='gas', bucket='hour', miner=first['name'])
        self.assertEqual((gas['unit'], gas['summary']['readings'], gas['summary']['average']), ('ppm', 2, 200))
        self.assertEqual((gas['series'][0]['count'], gas['series'][0]['average']), (1, 100))

        _, zone = self.analytics('readings', **window, metric='battery', zone=device_b['zone'])
        self.assertEqual((zone['bucket'], zone['summary']['readings'], zone['summary']['average']), ('hour', 1, 70))
        self.assertEqual([x['miner'] for x in zone['miners']], [second['name']])

        # Days follow Bolivia time: 05:00 UTC on 6 January belongs to the second local day.
        _, daily = self.analytics('readings', **{'from': '2026-01-05T04:00:00Z', 'to': '2026-01-07T04:00:00Z'}, bucket='day', zone=device_a['zone'])
        self.assertEqual([(x['start'], x['count'], x['average']) for x in daily['series']], [('2026-01-05T04:00:00Z', 3, 24.67), ('2026-01-06T04:00:00Z', 0, None)])
        _, daily = self.analytics('readings', **{'from': '2026-01-05T04:00:00Z', 'to': '2026-01-07T04:00:00Z'}, bucket='day', miner=second['name'])
        self.assertEqual([(x['count'], x['maximum']) for x in daily['series']], [(1, 40), (1, 10)])
        _, automatic = self.analytics('readings', **{'from': '2025-12-20T00:00:00Z', 'to': '2026-01-10T00:00:00Z'}, miner=second['name'])
        self.assertEqual((automatic['bucket'], len(automatic['series']), automatic['summary']['readings']), ('day', 22, 2))

        _, empty = self.analytics('readings', **{'from': '2025-06-01T00:00:00Z', 'to': '2025-06-02T00:00:00Z'})
        self.assertEqual(empty['summary'], {'readings': 0, 'average': None, 'maximum': None, 'minimum': None})
        self.assertEqual((len(empty['series']), empty['miners']), (24, []))
        self.assertTrue(all(x['count'] == 0 and x['average'] is None for x in empty['series']))

    def test_analytics_counts_messages_by_local_day_and_severity(self):
        (first, device_a), (second, _) = self.seed_history()
        window = {'from': '2026-01-05T04:00:00Z', 'to': '2026-01-07T04:00:00Z'}
        status, body = self.analytics('messages', **window, zone=device_a['zone'])
        self.assertEqual(status, 200, body)
        self.assertEqual(body['summary'], {'total': 3, 'critical': 2, 'warning': 1, 'info': 0, 'pendingCritical': 1})
        self.assertEqual(body['days'], [
            {'day': '2026-01-05', 'start': '2026-01-05T04:00:00Z', 'critical': 2, 'warning': 1, 'info': 0},
            {'day': '2026-01-06', 'start': '2026-01-06T04:00:00Z', 'critical': 0, 'warning': 0, 'info': 0},
        ])
        _, theirs = self.analytics('messages', **window, miner=second['name'])
        self.assertEqual(theirs['summary'], {'total': 2, 'critical': 0, 'warning': 0, 'info': 2, 'pendingCritical': 0})
        self.assertEqual([x['info'] for x in theirs['days']], [0, 2])
        _, options = self.analytics('options')
        self.assertTrue({first['name'], second['name']} <= set(options['miners']))
        self.assertIn(device_a['zone'], options['zones'])
        self.assertEqual(options['maxRangeDays'], 90)

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

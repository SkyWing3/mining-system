"""End-to-end checks of the actual Compose images, isolated from production.

Run: device/.venv/bin/python -m unittest discover -s tests/docker -v
Requires Docker Compose and Python websockets. Builds images using Docker only.
"""
import http.cookiejar
import io
import json
import os
import re
import socket
import subprocess
import tarfile
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
import wave
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]
PASSWORD = 'Docker-Integration-2026!'


class DockerStackTests(unittest.TestCase):
    @classmethod
    def compose(cls, *args, timeout=300):
        result = subprocess.run(
            ['docker', 'compose', '--env-file', '/dev/null', '-p', cls.project, *args],
            cwd=ROOT, env=cls.environment, capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode:
            raise RuntimeError(f'Compose {args[0]} failed:\n{result.stdout}\n{result.stderr}')
        return result.stdout

    @classmethod
    def setUpClass(cls):
        cls.project = 'mining-docker-test-' + uuid.uuid4().hex[:10]
        cls.secrets = tempfile.TemporaryDirectory(prefix='mining-mysql-secrets-')
        cls.addClassCleanup(cls.secrets.cleanup)
        with socket.socket() as available:
            available.bind(('127.0.0.1', 0))
            cls.port = available.getsockname()[1]
        cls.environment = {
            **os.environ,
            'COMPOSE_PROJECT_NAME': cls.project,
            'MINING_HTTP_PORT': str(cls.port),
            'MINING_SECRETS_DIRECTORY': cls.secrets.name,
            # Same-origin access must work without relying on a CORS exception.
            'MINING_PUBLIC_ORIGIN': 'http://unused-origin.invalid',
            'MINING_DOCKER_SUBNET': os.environ.get('MINING_TEST_SUBNET', '172.30.85.0/24'),
        }
        cls.base = f'http://127.0.0.1:{cls.port}'
        cls.host = f'franco-rasp4.local:{cls.port}'
        cls.origin = f'http://{cls.host}'
        cls.cookies = http.cookiejar.CookieJar()
        cls.client = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cls.cookies),
        )
        cls.addClassCleanup(cls.compose, 'down', '--volumes', '--remove-orphans')
        with tempfile.TemporaryDirectory(prefix='mining-start-test-') as outside_repository:
            started = subprocess.run(
                [str(ROOT / 'start.sh')], cwd=outside_repository, env=cls.environment,
                capture_output=True, text=True, timeout=900,
            )
        if started.returncode:
            raise RuntimeError(f'start.sh failed:\n{started.stdout}\n{started.stderr}')
        if 'Mining System listo: ' not in started.stdout:
            raise RuntimeError('start.sh did not report successful startup')
        status, _, body = cls.call('/api/auth/setup', 'POST', {
            'name': 'Docker Administrator', 'email': 'docker@test.invalid', 'password': PASSWORD,
        })
        if status != 200:
            raise RuntimeError(f'Test setup failed: HTTP {status}, {body}')

    @classmethod
    def call(cls, path, method='GET', body=None, headers=None):
        request = urllib.request.Request(
            cls.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={
                'Host': cls.host, 'Origin': cls.origin,
                'Content-Type': 'application/json', 'X-Mining-Client': 'web',
                **(headers or {}),
            },
        )
        try:
            response = cls.client.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            content_type = response.headers.get('Content-Type', '')
            if 'application/json' in content_type:
                body = json.loads(content)
            elif content_type.startswith('audio/'):
                body = content
            else:
                body = content.decode()
            return response.status, response.headers, body

    @classmethod
    def ws(cls, path, headers=None, origin=None):
        # Use the actual mDNS Host/Origin while connecting to the local test port.
        tcp = socket.create_connection(('127.0.0.1', cls.port), timeout=5)
        return connect(
            f'ws://{cls.host}{path}', sock=tcp, origin=origin,
            additional_headers=headers, proxy=None, open_timeout=5, close_timeout=1,
        )

    @classmethod
    @contextmanager
    def browser_socket(cls):
        cookie = '; '.join(f'{item.name}={item.value}' for item in cls.cookies)
        with cls.ws('/hubs/mining', {'Cookie': cookie}, cls.origin) as browser:
            browser.send('{"protocol":"json","version":1}\x1e')
            if '{}' not in browser.recv(timeout=5):
                raise RuntimeError('SignalR handshake failed')
            yield browser

    def test_01_react_routes_api_and_login(self):
        status, headers, html = self.call('/')
        self.assertEqual(status, 200)
        self.assertIn('<div id="root">', html)
        asset = re.search(r'src="(/assets/[^\"]+\.js)"', html).group(1)
        self.assertEqual(self.call(asset)[0], 200)
        self.assertIn('immutable', self.call(asset)[1]['Cache-Control'])
        self.assertEqual(self.call('/messages')[2], html)
        self.assertEqual(self.call('/api/does-not-exist')[0], 404)
        self.assertEqual(self.call('/health')[2]['status'], 'ok')
        self.assertEqual(self.call('/api/overview')[0], 200)
        status, headers, _ = self.call('/api/auth/login', 'POST', {
            'email': 'docker@test.invalid', 'password': PASSWORD,
        })
        self.assertEqual(status, 200)
        self.assertIn('httponly', headers['Set-Cookie'].lower())
        self.assertIn('samesite=strict', headers['Set-Cookie'].lower())
        self.assertEqual(self.call('/api/overview', headers={'Origin': 'http://foreign.invalid'})[0], 403)
        self.assertEqual(self.call('/api/auth/login', 'POST', {}, {'X-Mining-Client': ''})[0], 403)

    def test_02_device_to_browser_websockets(self):
        status, _, miner = self.call('/api/users', 'POST', {
            'name': 'Docker Miner', 'email': 'miner@test.invalid',
            'password': PASSWORD, 'role': 'Miner', 'active': True,
        })
        self.assertEqual(status, 200)
        status, _, registered = self.call('/api/devices', 'POST', {
            'name': 'Docker Wearable', 'zone': 'Galería Docker',
            'userId': miner['id'], 'active': True,
        })
        self.assertEqual(status, 200)
        type(self).device = registered['device']
        type(self).device_key = registered['apiKey']
        with self.browser_socket() as browser:
            with self.ws('/ws/device', {'X-Device-Key': self.device_key}) as device:
                frame = {
                    'type': 'message', 'code': 'COLLAPSE', 'clientMessageId': uuid.uuid4().hex,
                    'sentAt': datetime.now(timezone.utc).isoformat(),
                }
                started = time.monotonic()
                device.send(json.dumps(frame))
                ack = json.loads(device.recv(timeout=5))
                self.assertEqual(ack['type'], 'ack')
                type(self).message_id = ack['messageId']
                received = None
                deadline = started + 5
                while time.monotonic() < deadline and received is None:
                    for part in browser.recv(timeout=5).split('\x1e'):
                        event = json.loads(part) if part else {}
                        if event.get('target') == 'MessageReceived':
                            received = event['arguments'][0]
                self.assertIsNotNone(received)
                self.assertEqual(received['text'], 'Hay derrumbe')
                self.assertEqual(received['deviceId'], self.device['id'])
                self.assertLess(time.monotonic() - started, 3)
                device.send(json.dumps(frame))
                duplicate = json.loads(device.recv(timeout=5))
                self.assertEqual(duplicate['messageId'], self.message_id)
                self.assertTrue(duplicate['duplicate'])
                device.send(json.dumps({'type': 'telemetry', 'temperatureC': 28.5, 'batteryPercent': 80}))
                self.assertEqual(json.loads(device.recv(timeout=5))['type'], 'ack')
        status, _, messages = self.call('/api/messages?deviceId=' + self.device['id'])
        self.assertEqual(status, 200)
        self.assertEqual(messages['total'], 1)

    def test_02b_voice_upload_passes_the_proxy_and_is_playable(self):
        # 45 s of 16 kHz audio is larger than Nginx's default 1 MB body limit.
        output = io.BytesIO()
        with wave.open(output, 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b'\x10\x00' * 16000 * 45)
        recording = output.getvalue()
        request = urllib.request.Request(self.base + '/api/device/voice', data=recording, method='POST', headers={
            'Host': self.host, 'Content-Type': 'audio/wav', 'X-Device-Key': self.device_key,
            'X-Client-Message-Id': uuid.uuid4().hex, 'X-Recorded-At': datetime.now(timezone.utc).isoformat(),
        })
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=15) as response:
            self.assertEqual(response.status, 201)
            voice = json.loads(response.read())['voice']
        self.assertEqual(voice['durationMs'], 45000)
        status, headers, body = self.call(f"/api/voice/{voice['id']}/audio")
        self.assertEqual((status, headers['Content-Type'], len(body)), (200, 'audio/wav', len(recording)))

    def test_03_unauthenticated_websockets_are_rejected(self):
        with self.assertRaises(InvalidStatus) as browser:
            with self.ws('/hubs/mining', origin=self.origin):
                pass
        self.assertEqual(browser.exception.response.status_code, 401)
        with self.assertRaises(InvalidStatus) as device:
            with self.ws('/ws/device', {'X-Device-Key': '0' * 64}):
                pass
        self.assertEqual(device.exception.response.status_code, 401)

    def test_04_backend_replacement_preserves_data_sessions_and_proxy_dns(self):
        backend_id = self.compose('ps', '-q', 'backend').strip()
        web_id = self.compose('ps', '-q', 'web-app').strip()
        container = json.loads(subprocess.check_output(['docker', 'inspect', backend_id]))[0]
        network, endpoint = next(iter(container['NetworkSettings']['Networks'].items()))
        old_ip = endpoint['IPAddress']
        self.assertNotEqual(container['Config']['User'], '0')
        self.assertTrue(container['HostConfig']['ReadonlyRootfs'])
        self.assertFalse(container['HostConfig']['PortBindings'])
        self.assertEqual(self.call('/health')[0], 200)  # Populate Nginx's DNS cache.
        self.compose('rm', '--stop', '--force', 'backend')
        reserve = self.project + '-reserve-ip'
        try:
            # Force a different backend IP, as occurs during real replacements.
            subprocess.run([
                'docker', 'run', '-d', '--rm', '--name', reserve,
                '--network', network, '--ip', old_ip,
                '--entrypoint', 'sleep', 'mining-system-web-app:local', '120',
            ], check=True, capture_output=True)
            self.compose('up', '-d', '--no-deps', '--wait', 'backend')
            new_id = self.compose('ps', '-q', 'backend').strip()
            new_container = json.loads(subprocess.check_output(['docker', 'inspect', new_id]))[0]
            self.assertNotEqual(new_container['NetworkSettings']['Networks'][network]['IPAddress'], old_ip)
            deadline = time.monotonic() + 25
            while self.call('/health')[0] != 200:
                if time.monotonic() >= deadline:
                    self.fail('Nginx did not re-resolve the replaced backend')
                time.sleep(.5)
            self.assertEqual(self.compose('ps', '-q', 'web-app').strip(), web_id)
            status, _, messages = self.call('/api/messages?deviceId=' + self.device['id'])
            self.assertEqual(status, 200)  # Existing cookie still decrypts after replacement.
            self.assertEqual(messages['total'], 1)
            self.assertEqual(messages['items'][0]['id'], self.message_id)
            with self.browser_socket():
                pass
            with self.ws('/ws/device', {'X-Device-Key': self.device_key}) as device:
                device.send('{"type":"heartbeat"}')
                self.assertEqual(json.loads(device.recv(timeout=5))['type'], 'ack')
        finally:
            subprocess.run(['docker', 'rm', '-f', reserve], capture_output=True)

    def test_05_backup_and_restore_with_the_unprivileged_service_user(self):
        self.compose('stop', 'backend')
        command = ['docker', 'compose', '--env-file', '/dev/null', '-p', self.project]
        backup = subprocess.run([
            *command, 'run', '--rm', '-T', '--no-deps', '--entrypoint', 'tar',
            'backend', '-czf', '-', '-C', '/var/lib/mining-system', '.',
        ], cwd=ROOT, env=self.environment, capture_output=True, check=True, timeout=30)
        with tarfile.open(fileobj=io.BytesIO(backup.stdout), mode='r:gz') as archive:
            self.assertTrue(any(name.startswith('./keys/key-') for name in archive.getnames()))
        # Restore into a separate directory within this temporary test volume.
        restored = subprocess.run([
            *command, 'run', '--rm', '-T', '--no-deps', '--entrypoint', 'sh', 'backend', '-c',
            'mkdir /var/lib/mining-system/restore-check && '
            'tar --no-same-owner -xzf - -C /var/lib/mining-system/restore-check && '
            'test -d /var/lib/mining-system/restore-check/keys',
        ], cwd=ROOT, env=self.environment, input=backup.stdout, capture_output=True, timeout=30)
        self.assertEqual(restored.returncode, 0, restored.stderr.decode())
        dump = subprocess.run([
            *command, 'exec', '-T', 'mysql', 'sh', '-c',
            'export MYSQL_PWD="$(cat /run/secrets/mysql_password)"; '
            'exec mysqldump --user=mining --single-transaction --no-tablespaces mining_system',
        ], cwd=ROOT, env=self.environment, capture_output=True, check=True, timeout=30)
        self.assertIn(b'CREATE TABLE', dump.stdout)
        restore_sql = b'CREATE DATABASE mining_restore_test; USE mining_restore_test;\n' + dump.stdout
        restore_sql += b'\nSELECT COUNT(*) FROM Messages; DROP DATABASE mining_restore_test;'
        result = subprocess.run([
            *command, 'exec', '-T', 'mysql', 'sh', '-c',
            'export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"; exec mysql --user=root --batch --skip-column-names',
        ], cwd=ROOT, env=self.environment, input=restore_sql, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'1', result.stdout)

    def test_06_script_down_and_restart_preserve_data_and_sessions(self):
        with tempfile.TemporaryDirectory(prefix='mining-down-test-') as outside_repository:
            stopped = subprocess.run(
                [str(ROOT / 'start.sh'), '--down'], cwd=outside_repository, env=self.environment,
                capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(stopped.returncode, 0, stopped.stderr)
            self.assertIn('Datos conservados.', stopped.stdout)
            self.assertEqual(self.compose('ps', '--all', '-q').strip(), '')
            volume = subprocess.run(
                ['docker', 'volume', 'inspect', self.project + '_central-data'],
                capture_output=True, timeout=10,
            )
            self.assertEqual(volume.returncode, 0, volume.stderr.decode())
            self.assertEqual(subprocess.run(['docker', 'volume', 'inspect', self.project + '_mysql-data'], capture_output=True, timeout=10).returncode, 0)
            restarted = subprocess.run(
                [str(ROOT / 'start.sh')], cwd=outside_repository, env=self.environment,
                capture_output=True, text=True, timeout=900,
            )
            self.assertEqual(restarted.returncode, 0, restarted.stderr)
        status, _, messages = self.call('/api/messages?deviceId=' + self.device['id'])
        self.assertEqual(status, 200)  # The existing session still works after down/up.
        self.assertEqual(messages['total'], 1)
        self.assertEqual(messages['items'][0]['id'], self.message_id)

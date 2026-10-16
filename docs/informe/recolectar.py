"""Recoge evidencias reales en una base MySQL temporal, sin datos de producción."""
import http.cookiejar
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from mysql_test_db import create, drop, sql

OUTPUT = Path(__file__).resolve().parent
(OUTPUT / 'evidencias').mkdir(exist_ok=True)
(OUTPUT / 'figuras').mkdir(exist_ok=True)
BASE = 'http://127.0.0.1:5083'
PASSWORD = 'Informe-Demo-2026!'
database = create('report')
trace = {'recordedAt': datetime.now(timezone.utc).isoformat(), 'environment': 'MySQL local real; base temporal; datos inyectados para pruebas, no mediciones físicas', 'requests': []}
cookies = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def sanitize(value):
    if isinstance(value, dict):
        return {key: '[REDACTADO]' if key.lower() in ('password', 'apikey', 'passwordhash', 'keyhash') else sanitize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


def call(path, method='GET', body=None, anonymous=False):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={'Content-Type': 'application/json', 'X-Mining-Client': 'web'})
    try:
        response = (urllib.request.urlopen if anonymous else client.open)(req, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        content = response.read()
        value = json.loads(content) if content else None
        trace['requests'].append({'method': method, 'path': path, 'status': response.status, 'request': sanitize(body), 'response': sanitize(value)})
        return response.status, value


with tempfile.TemporaryDirectory(prefix='mining-report-') as folder:
    env = {**os.environ, 'Mining__DataDirectory': folder, 'Mining__ConnectionString': database['connectionString'], 'Logging__LogLevel__Default': 'Warning'}
    with open(Path(folder) / 'server.log', 'w') as log:
        server = subprocess.Popen(['dotnet', str(ROOT / 'backend/bin/Debug/net10.0/backend.dll'), '--contentRoot', str(ROOT / 'backend'), '--urls', BASE], env=env, stdout=log, stderr=log)
        try:
            for attempt in range(100):
                try:
                    if urllib.request.urlopen(BASE + '/health', timeout=.5).status == 200:
                        break
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(.1)
            else:
                raise RuntimeError('La API de evidencias no inició')
            assert call('/api/overview', anonymous=True)[0] == 401
            assert call('/api/auth/setup', 'POST', {'name': 'Administración de prueba', 'email': 'admin@informe.invalid', 'password': PASSWORD})[0] == 200
            assert call('/api/auth/login', 'POST', {'email': 'admin@informe.invalid', 'password': 'clave-incorrecta'}, anonymous=True)[0] == 401
            status, miner = call('/api/users', 'POST', {'name': 'Minero de demostración', 'email': 'minero@informe.invalid', 'password': PASSWORD, 'role': 'Miner', 'active': True})
            assert status == 200
            assert call('/api/users', 'POST', {'name': 'Duplicado', 'email': 'minero@informe.invalid', 'password': PASSWORD, 'role': 'Miner'})[0] == 409
            status, device = call('/api/devices', 'POST', {'name': 'Manilla de prueba', 'zone': 'Galería de demostración', 'userId': miner['id'], 'active': True})
            assert status == 200
            cookie = '; '.join(f'{item.name}={item.value}' for item in cookies)
            with connect('ws://127.0.0.1:5083/hubs/mining', additional_headers={'Cookie': cookie}, origin=BASE, proxy=None) as browser:
                browser.send('{"protocol":"json","version":1}\x1e')
                assert '{}' in browser.recv(timeout=3)
                with connect('ws://127.0.0.1:5083/ws/device', additional_headers={'X-Device-Key': device['apiKey']}, proxy=None) as node:
                    frame = {'type': 'message', 'code': 'COLLAPSE', 'clientMessageId': 'informe-mensaje-001', 'sentAt': datetime.now(timezone.utc).isoformat()}
                    start = time.perf_counter()
                    node.send(json.dumps(frame))
                    first = json.loads(node.recv(timeout=3))
                    received = None
                    while received is None:
                        for part in browser.recv(timeout=3).split('\x1e'):
                            event = json.loads(part) if part else {}
                            if event.get('target') == 'MessageReceived':
                                received = event
                    trace['websocket'] = {'frame': frame, 'ack': first, 'browserEvent': received, 'localLatencyMs': round((time.perf_counter() - start) * 1000, 3)}
                    node.send(json.dumps(frame))
                    retry = json.loads(node.recv(timeout=3))
                    assert retry['duplicate'] and retry['messageId'] == first['messageId']
                    trace['websocket']['retryAck'] = retry
                    node.send(json.dumps({'type': 'telemetry', 'temperatureC': 28.6, 'gasPpm': 410, 'batteryPercent': 86}))
                    assert json.loads(node.recv(timeout=3))['type'] == 'ack'
                    node.send(json.dumps({'type': 'telemetry', 'batteryPercent': 101}))
                    invalid = json.loads(node.recv(timeout=3))
                    assert invalid['type'] == 'error'
                    trace['websocket']['invalidTelemetry'] = invalid
            _, messages = call('/api/messages')
            assert messages['total'] == 1
            assert call('/api/devices/' + device['device']['id'] + '/telemetry')[1][0]['temperatureC'] == 28.6
            assert call(f"/api/messages/{first['messageId']}/review", 'POST')[0] == 200
            call('/api/overview')
            trace['mysqlVersion'] = sql('SELECT VERSION();').strip()
            trace['persistedCounts'] = sql(f"SELECT 'Users',COUNT(*) FROM `{database['name']}`.Users UNION ALL SELECT 'Messages',COUNT(*) FROM `{database['name']}`.Messages UNION ALL SELECT 'Readings',COUNT(*) FROM `{database['name']}`.Readings;").strip()
            trace['foreignKeys'] = sql(f"SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='{database['name']}' AND REFERENCED_TABLE_NAME IS NOT NULL;").strip()
            (OUTPUT / 'evidencias/api-mysql.json').write_text(json.dumps(trace, ensure_ascii=False, indent=2) + '\n')
            print(f"Evidencias reales guardadas: {len(trace['requests'])} solicitudes HTTP, inserción MySQL, idempotencia y evento SignalR.")
        finally:
            server.terminate()
            server.wait(timeout=10)
            drop(database['name'])

for source, dest in [('login.png', 'acceso.png'), ('dashboard.png', 'dashboard.png'), ('messages.png', 'mensajes.png'), ('mobile.png', 'movil.png'), ('custom-select-desktop.png', 'registro-usuario.png'), ('analytics.png', 'analisis.png')]:
    shutil.copy2(ROOT / 'web-app/test-results' / source, OUTPUT / 'figuras' / dest)
shutil.copy2(ROOT / 'docs/wokwi/diagrama.pdf', OUTPUT / 'figuras/circuito.pdf')
shutil.copy2(ROOT / 'docs/wokwi/diagrama.png', OUTPUT / 'figuras/circuito.png')
shutil.copy2(ROOT / 'docs/mysql-schema.sql', OUTPUT / 'evidencias/mysql-schema.sql')

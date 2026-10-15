"""Isolated MySQL databases for API/browser tests; never touches the application DB."""
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def settings():
    path = ROOT / 'data/mysql-test.json'
    config = json.loads(path.read_text()) if path.exists() else {}
    for key in ('host', 'port', 'user', 'password'):
        value = os.environ.get('MINING_TEST_MYSQL_' + key.upper())
        if value is not None:
            config[key] = value
    if 'password' not in config:
        raise RuntimeError('Configura MINING_TEST_MYSQL_HOST/PORT/USER/PASSWORD para una instancia MySQL de pruebas. Consulta docs/mysql.md.')
    return {'host': '127.0.0.1', 'port': '3306', 'user': 'root', **config}


def sql(statement):
    config = settings()
    def quote(value):
        return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') + '"'
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', suffix='.cnf') as file:
        file.write('[client]\nprotocol=tcp\n' + ''.join(f'{key}={quote(value)}\n' for key, value in config.items()))
        file.flush()
        result = subprocess.run(['mysql', f'--defaults-extra-file={file.name}', '--batch', '--skip-column-names'], input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('MySQL de pruebas no respondió: ' + result.stderr.strip())
    return result.stdout


def create(kind='api'):
    if kind not in ('api', 'browser', 'report'):
        raise ValueError('Tipo de base de pruebas inválido')
    name = f'mining_test_{kind}_{uuid.uuid4().hex}'
    sql(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;')
    c = settings()
    # Quote connection-string values independently from SQL and shell quoting.
    def quote(value):
        return '"' + str(value).replace('"', '""') + '"'
    connection = ';'.join(f'{key}={quote(value)}' for key, value in [('Server', c['host']), ('Port', c['port']), ('User ID', c['user']), ('Password', c['password']), ('Database', name), ('SslMode', 'Preferred')])
    return {'name': name, 'connectionString': connection}


def drop(name):
    if not re.fullmatch(r'mining_test_(api|browser|report)_[0-9a-f]{32}', name):
        raise ValueError('Solo se eliminan las bases temporales con un nombre de pruebas válido')
    sql(f'DROP DATABASE IF EXISTS `{name}`;')


if __name__ == '__main__':
    if sys.argv[1] == 'create':
        print(json.dumps(create(sys.argv[2])))
    elif sys.argv[1] == 'drop':
        drop(sys.argv[2])
    else:
        raise SystemExit('Usar create api|browser|report, o drop NOMBRE_TEMPORAL')

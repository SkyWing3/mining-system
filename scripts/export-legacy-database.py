"""One-time, read-only export of the former database into a private JSON file.

The application itself does not load or depend on the old database engine.
Run with the former backend stopped, then use --import-legacy on the new API.
"""
import argparse
import json
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('database', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
result = {}
with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as db:
    db.row_factory = sqlite3.Row
    for table in ('Users', 'Devices', 'Messages', 'Readings', 'Events'):
        rows = []
        for source in db.execute(f'SELECT * FROM "{table}"'):
            row = dict(source)
            for key, value in row.items():
                if key == 'Active':
                    row[key] = bool(value)
                elif value is not None and key.endswith('At'):
                    row[key] = value.replace(' ', 'T').removesuffix('Z') + 'Z'
            rows.append(row)
        result[table] = rows
descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
    json.dump(result, output, ensure_ascii=False)
print('Exportación privada creada. Base original conservada; no se imprimieron credenciales.')

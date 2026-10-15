#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
dotnet build backend/backend.csproj
dotnet test tests/backend.unit
if [ ! -d device/.venv ]; then python3 -m venv device/.venv; fi
device/.venv/bin/python -m pip install 'Pillow>=10,<13' 'websockets>=15,<18'
(cd device && .venv/bin/python -m unittest discover -s tests -v)
device/.venv/bin/python -m unittest discover -s tests/backend -v
npm --prefix web-app ci
npm --prefix web-app run build
npm --prefix web-app run lint
(cd web-app && npx playwright install chromium && npm run test:e2e)

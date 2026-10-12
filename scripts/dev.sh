#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
if [ ! -d web-app/node_modules ]; then npm --prefix web-app ci; fi
api_pid=""
web_pid=""
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$web_pid" ]; then kill "$web_pid" 2>/dev/null || true; fi
  if [ -n "$api_pid" ]; then kill "$api_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
ASPNETCORE_ENVIRONMENT=Development dotnet run --project backend/backend.csproj --no-launch-profile --urls http://localhost:5080 &
api_pid=$!
for attempt in {1..60}; do
  if curl -fsS http://localhost:5080/health >/dev/null 2>&1; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then exit 1; fi
  sleep 1
done
curl -fsS http://localhost:5080/health >/dev/null
npm --prefix web-app run dev &
web_pid=$!
printf '\nMining System: http://localhost:5173\nAPI: http://localhost:5080\nCtrl+C para detener ambos servicios.\n\n'
wait "$web_pid"

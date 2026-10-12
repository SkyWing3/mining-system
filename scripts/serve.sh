#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "$repo_root/build/server/backend.dll" ]; then "$repo_root/scripts/build.sh"; fi
export Mining__DataDirectory="${Mining__DataDirectory:-$repo_root/data}"
cd "$repo_root/build/server"
exec dotnet backend.dll --urls "${MINING_BIND_URL:-http://localhost:5080}"

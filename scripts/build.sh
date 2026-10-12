#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
npm --prefix web-app ci
npm --prefix web-app run build
mkdir -p backend/wwwroot
cp -R web-app/dist/. backend/wwwroot/
dotnet publish backend/backend.csproj -c Release -o build/server
printf '\nAplicación compilada en build/server. Ejecuta ./scripts/serve.sh\n'

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

usage() {
  printf 'Uso: ./start.sh [--down | --help]\n\nSin argumentos: compila e inicia la central.\n--down: detiene la central y conserva sus datos.\n'
}

action=up
if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi
case "${1:-}" in
  '') ;;
  --down) action=down ;;
  --help|-h) usage; exit 0 ;;
  *) printf 'Opción desconocida: %s\n' "$1" >&2; usage >&2; exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker no está instalado. Este script requiere Docker Engine y Docker Compose.\n' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  printf 'No se encuentra el plugin Docker Compose.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'No se puede acceder a Docker. Comprueba que esté iniciado; si faltan permisos, repite el mismo comando con sudo.\n' >&2
  exit 1
fi

compose=(docker compose --project-directory "$repo_root" --file "$repo_root/compose.yaml")
if [[ "$action" == up ]]; then
  "$repo_root/scripts/init-mysql-secrets.sh"
fi
"${compose[@]}" config --quiet

if [[ "$action" == down ]]; then
  "${compose[@]}" down
  printf '\nMining System detenido. Datos conservados.\n'
  exit 0
fi

printf 'Compilando e iniciando Mining System...\n'
if ! "${compose[@]}" up --detach --build --wait --wait-timeout 300; then
  printf '\nNo se pudo completar el arranque. Estado y últimos logs:\n' >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --tail=40 >&2 || true
  exit 1
fi

public_origin=""
while IFS='=' read -r name value; do
  if [[ "$name" == MINING_PUBLIC_ORIGIN && -n "$value" ]]; then
    public_origin="$value"
  fi
done < <("${compose[@]}" config --environment)
if [[ -z "$public_origin" ]]; then
  published_address="$("${compose[@]}" port web-app 8080)"
  http_port="${published_address##*:}"
  public_origin="http://franco-rasp4.local"
  if [[ "$http_port" != 80 ]]; then
    public_origin+=":$http_port"
  fi
fi

printf '\nMining System listo: %s\n' "$public_origin"
"${compose[@]}" ps

#!/usr/bin/env bash
set -euo pipefail

# Run on the central Raspberry Pi: sudo ./scripts/setup-raspberry-pi.sh
pi_hostname="${1:-franco-rasp4}"
if [[ $# -gt 1 || ! "$pi_hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]]; then
  printf 'Uso: sudo %s [hostname, por defecto franco-rasp4]\n' "$0" >&2
  exit 1
fi
if [[ "$(uname -s)" != Linux || "$(id -u)" != 0 ]]; then
  printf 'Ejecuta este script con sudo dentro de la Raspberry Pi.\n' >&2
  exit 1
fi
if [[ "$(dpkg --print-architecture)" != arm64 ]]; then
  printf 'La central requiere Raspberry Pi OS de 64 bits (arm64).\n' >&2
  exit 1
fi
. /etc/os-release
if [[ "$ID" != debian && "$ID" != raspbian ]]; then
  printf 'Este instalador está preparado para Raspberry Pi OS / Debian.\n' >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl avahi-daemon avahi-utils libnss-mdns

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  # Avoid implicitly replacing an existing distribution-specific Docker install.
  for package in docker.io docker-compose podman-docker; do
    if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" == 'install ok installed' ]]; then
      printf 'Existe el paquete %s. Sigue la migración oficial a Docker CE antes de continuar: https://docs.docker.com/engine/install/debian/\n' "$package" >&2
      exit 1
    fi
  done
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

hostnamectl set-hostname "$pi_hostname"
if ! awk -v host="$pi_hostname" '$1 == "127.0.1.1" { for (i=2; i<=NF; i++) if ($i == host) found=1 } END { exit !found }' /etc/hosts; then
  printf '\n127.0.1.1\t%s\n' "$pi_hostname" >> /etc/hosts
fi
systemctl enable --now docker avahi-daemon
systemctl restart avahi-daemon
docker compose version
printf '\nPreparado. Desde la raíz del proyecto:\n  sudo docker compose up -d --build --wait\nAbrir http://%s.local\n' "$pi_hostname"

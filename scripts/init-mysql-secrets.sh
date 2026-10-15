#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
secrets_directory="${MINING_SECRETS_DIRECTORY:-$repo_root/secrets}"
umask 077
mkdir -p "$secrets_directory"
for name in mysql_password mysql_root_password; do
  path="$secrets_directory/$name"
  if [[ ! -s "$path" ]]; then
    openssl rand -hex 32 > "$path"
  fi
done
# Compose mounts file-backed secrets with host file permissions. The parent
# directory stays private; the backend's unprivileged container UID must read it.
chmod 700 "$secrets_directory"
chmod 644 "$secrets_directory/mysql_password"

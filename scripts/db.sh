#!/usr/bin/env bash
# A throwaway local PostgreSQL 16 for development and tests (port 55432, data under .local/pg).
# CI uses a postgres:16 service container instead.
set -euo pipefail
cmd="${1:-up}"
here="$(cd "$(dirname "$0")/.." && pwd)"
data="$here/.local/pg"
bin="$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)"
run() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
case "$cmd" in
  up)
    mkdir -p "$data"
    [ "$(id -u)" = "0" ] && chown postgres "$data" "$here/.local"
    [ -f "$data/PG_VERSION" ] || run "$bin/initdb" -D "$data" -A trust -U postgres >/dev/null
    run "$bin/pg_ctl" -D "$data" -o "-p 55432 -k $data" -l "$data/log" status >/dev/null 2>&1 \
      || run "$bin/pg_ctl" -D "$data" -o "-p 55432 -k $data" -l "$data/log" start >/dev/null
    psql -h 127.0.0.1 -p 55432 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'rop'" | grep -q 1 \
      || psql -h 127.0.0.1 -p 55432 -U postgres -qc "CREATE DATABASE rop"
    echo "PostgreSQL on 127.0.0.1:55432 (database rop)"
    ;;
  down) run "$bin/pg_ctl" -D "$data" stop ;;
  *) echo "usage: scripts/db.sh up|down" >&2; exit 2 ;;
esac

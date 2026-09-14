#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

docker compose exec -T postgres_backup /usr/local/bin/postgres-backup-once.sh

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "用法：./scripts/verify-postgres-backup.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump" >&2
  exit 2
fi
if [[ "$1" != *.dump ]]; then
  echo "只接受当前标准的 .dump custom 格式备份。" >&2
  exit 2
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
backup_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
backup_root="${BACKUP_ROOT:-$project_root/backups/postgres}"
if [[ ! -d "$backup_root" ]]; then
  echo "备份目录不存在：$backup_root" >&2
  exit 2
fi
backup_root="$(cd "$backup_root" && pwd)"
case "$backup_file" in
  "$backup_root/"*) ;;
  *) echo "备份文件必须位于允许的备份目录：$backup_root" >&2; exit 2 ;;
esac
container_file="${BACKUP_CONTAINER_ROOT:-/backups}/$(basename "$backup_file")"
minimum_bytes="${BACKUP_MIN_BYTES:-4096}"
actual_bytes="$(wc -c < "$backup_file" | tr -d ' ')"
if [[ "$actual_bytes" -lt "$minimum_bytes" ]]; then
  echo "备份文件过小：${actual_bytes} 字节，最低要求 ${minimum_bytes} 字节。" >&2
  exit 1
fi

catalog="$(docker compose exec -T postgres_backup pg_restore --list "$container_file")"
if ! grep -Eq '[[:space:]]TABLE DATA[[:space:]]+public[[:space:]]' <<< "$catalog"; then
  echo "备份目录中没有 public schema 的表数据。" >&2
  exit 1
fi
table_data_count="$(grep -Ec '[[:space:]]TABLE DATA[[:space:]]+public[[:space:]]' <<< "$catalog")"
echo "备份校验通过：$(basename "$backup_file")，${actual_bytes} 字节，${table_data_count} 个表数据条目。"

#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/backups}"
backup_prefix="${BACKUP_PREFIX:-migra}"
minimum_bytes="${BACKUP_MIN_BYTES:-4096}"
pg_dump_bin="${PG_DUMP_BIN:-pg_dump}"
pg_restore_bin="${PG_RESTORE_BIN:-pg_restore}"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
lock_directory="${backup_dir}/.${backup_prefix}-backup.lock"
temporary_file=""
list_file=""
backup_file=""

log_event() {
  level="$1"
  event="$2"
  message="$3"
  printf '%s level=%s event=%s message="%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$event" "$message"
}

cleanup() {
  if [ -n "$temporary_file" ]; then rm -f "$temporary_file"; fi
  if [ -n "$list_file" ]; then rm -f "$list_file"; fi
  rmdir "$lock_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

case "$minimum_bytes" in
  ''|*[!0-9]*) log_event ERROR backup_invalid_config "BACKUP_MIN_BYTES 必须是正整数" >&2; exit 2 ;;
esac
if [ "$minimum_bytes" -lt 1 ]; then
  log_event ERROR backup_invalid_config "BACKUP_MIN_BYTES 必须大于零" >&2
  exit 2
fi

mkdir -p "$backup_dir"
if ! mkdir "$lock_directory" 2>/dev/null; then
  log_event ERROR backup_already_running "已有数据库备份正在执行" >&2
  exit 3
fi
backup_file="${backup_dir}/${backup_prefix}-${timestamp}.dump"
sequence=1
while [ -e "$backup_file" ]; do
  backup_file="${backup_dir}/${backup_prefix}-${timestamp}-$(printf '%02d' "$sequence").dump"
  sequence=$((sequence + 1))
done
temporary_file="${backup_file}.$$.tmp"
list_file="${backup_file}.$$.list.tmp"
log_event INFO backup_started "开始创建 PostgreSQL custom 备份"

if ! "$pg_dump_bin" \
  --host="${PGHOST:-postgres}" \
  --port="${PGPORT:-5432}" \
  --username="${PGUSER:-migra_backup}" \
  --dbname="${PGDATABASE:-migra}" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$temporary_file"; then
  log_event ERROR backup_dump_failed "pg_dump 执行失败；未生成正式备份" >&2
  exit 1
fi

actual_bytes="$(wc -c < "$temporary_file" | tr -d ' ')"
if [ "$actual_bytes" -lt "$minimum_bytes" ]; then
  log_event ERROR backup_too_small "备份只有 ${actual_bytes} 字节，低于最低要求 ${minimum_bytes} 字节" >&2
  exit 1
fi

if ! "$pg_restore_bin" --list "$temporary_file" > "$list_file"; then
  log_event ERROR backup_catalog_invalid "pg_restore 无法读取备份目录；未生成正式备份" >&2
  exit 1
fi
if ! grep -Eq '[[:space:]]TABLE DATA[[:space:]]+public[[:space:]]' "$list_file"; then
  log_event ERROR backup_catalog_empty "备份目录中没有 public schema 的表数据" >&2
  exit 1
fi

chmod 600 "$temporary_file"
mv "$temporary_file" "$backup_file"
log_event INFO backup_success "备份已验证并保存：$(basename "$backup_file")，${actual_bytes} 字节"
printf '%s\n' "$backup_file"

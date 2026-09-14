#!/bin/sh
set -eu

backup_interval_seconds="${BACKUP_INTERVAL_SECONDS:-86400}"
backup_retention_days="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p /backups

while true; do
  while ! pg_isready -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -U "${PGUSER:-migra_backup}" -d "${PGDATABASE:-migra}" >/dev/null 2>&1; do
    printf '%s level=WARN event=backup_database_wait message="等待 PostgreSQL 可用"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    sleep 5
  done

  if ! /usr/local/bin/postgres-backup-once.sh; then
    printf '%s level=ERROR event=backup_cycle_failed message="本轮数据库备份失败；不会记录为成功"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  fi

  find /backups -type f -name 'migra-*.dump' -mtime "+${backup_retention_days}" -delete
  sleep "$backup_interval_seconds"
done

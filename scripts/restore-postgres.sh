#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "恢复会覆盖当前数据库。确认后使用：CONFIRM_RESTORE=YES ./scripts/restore-postgres.sh <备份文件>" >&2
  exit 2
fi

if [[ $# -ne 1 || ! -f "$1" || "$1" != *.dump ]]; then
  echo "请指定一个当前标准的 .dump PostgreSQL 备份文件。" >&2
  exit 2
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
backup_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$project_root"

./scripts/verify-postgres-backup.sh "$backup_file"

lock_directory="$project_root/backups/postgres/.${BACKUP_PREFIX:-migra}-backup.lock"
lock_acquired=0
cleanup() {
  if [[ "$lock_acquired" -eq 1 ]]; then rmdir "$lock_directory" 2>/dev/null || true; fi
}
trap cleanup EXIT HUP INT TERM
if ! mkdir "$lock_directory" 2>/dev/null; then
  echo "已有数据库备份或恢复正在执行，请等待完成后重试。" >&2
  exit 3
fi
lock_acquired=1

docker compose stop migra
restore_status=0
docker compose exec -T postgres pg_restore \
  --username="${POSTGRES_USER:-migra}" \
  --dbname="${POSTGRES_DB:-migra}" \
  --clean \
  --if-exists \
  --single-transaction \
  --exit-on-error \
  --no-owner \
  --no-privileges < "$backup_file" || restore_status=$?
if [[ "$restore_status" -ne 0 ]]; then
  echo "数据库恢复失败；事务已回滚，应用保持停止。修复原因后重新执行恢复。" >&2
  exit "$restore_status"
fi

migration_status=0
docker compose run --rm postgres_migrate || migration_status=$?
if [[ "$migration_status" -ne 0 ]]; then
  echo "数据库已经恢复，但迁移失败；应用保持停止。修复原因后重新执行迁移并人工启动应用。" >&2
  exit "$migration_status"
fi

# Run in Docker so restore does not require host node_modules.
integrity_status=0
docker compose run --rm --no-deps --entrypoint node migra scripts/check-file-integrity.mjs \
  --output /app/data/file-integrity-report.json || integrity_status=$?
if [[ "$integrity_status" -ne 0 ]]; then
  echo "数据库已成功恢复，但附件一致性检查发现异常或未能完成。请查看 data/file-integrity-report.json 和上方日志；系统不会自动删除或修改附件。" >&2
  if ! docker compose exec -T postgres psql --username="${POSTGRES_USER:-migra}" --dbname="${POSTGRES_DB:-migra}" -c "INSERT INTO audit_logs (id,occurred_at,actor_username_snapshot,action,entity_type,result,summary,request_id) VALUES ('aud_integrity_'||md5(clock_timestamp()::text||random()::text),clock_timestamp(),'SYSTEM','FILE_INTEGRITY_CHECK','SYSTEM','FAILURE','数据库恢复后的附件一致性检查发现异常或未能完成；详情见 file-integrity-report.json','integrity_'||md5(clock_timestamp()::text));" >/dev/null; then
    echo "附件检查失败日志写入数据库失败，请同时保留本次终端输出。" >&2
  fi
fi
docker compose exec -T postgres psql --username="${POSTGRES_USER:-migra}" --dbname="${POSTGRES_DB:-migra}" -c "INSERT INTO audit_logs (id,occurred_at,actor_username_snapshot,action,entity_type,result,summary,request_id) VALUES ('aud_restore_'||md5(clock_timestamp()::text||random()::text),clock_timestamp(),'SYSTEM','DATABASE_RESTORE','SYSTEM','SUCCESS','PostgreSQL 数据库恢复完成；附件检查结果见 file-integrity-report.json','restore_'||md5(clock_timestamp()::text));" >/dev/null
docker compose start migra
exit "$integrity_status"

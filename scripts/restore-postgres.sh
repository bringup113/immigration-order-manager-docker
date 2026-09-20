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

app_stopped=0
restart_app() {
  if [[ "$app_stopped" -eq 1 ]]; then docker compose start migra >/dev/null; fi
}
trap restart_app EXIT HUP INT TERM

docker compose stop migra
app_stopped=1
restore_status=0
./scripts/verify-postgres-backup.sh "$backup_file" || restore_status=$?
if [[ "$restore_status" -eq 0 ]]; then
  docker compose exec -T postgres pg_restore \
    --username="${POSTGRES_USER:-migra}" \
    --dbname="${POSTGRES_DB:-migra}" \
    --clean \
    --if-exists \
    --exit-on-error \
    --no-owner \
    --no-privileges < "$backup_file" || restore_status=$?
fi
if [[ "$restore_status" -eq 0 ]]; then
  docker compose run --rm postgres_migrate
  # Run in Docker so restore does not require host node_modules.
  docker compose run --rm --no-deps --entrypoint node migra scripts/check-file-integrity.mjs \
    --output /app/data/file-integrity-report.json || restore_status=$?
  if [[ "$restore_status" -ne 0 ]]; then
    echo "数据库已成功恢复，但附件一致性检查发现异常或未能完成。请查看 data/file-integrity-report.json 和上方日志；系统不会自动删除或修改附件。" >&2
    if ! docker compose exec -T postgres psql --username="${POSTGRES_USER:-migra}" --dbname="${POSTGRES_DB:-migra}" -c "INSERT INTO audit_logs (id,occurred_at,actor_username_snapshot,action,entity_type,result,summary,request_id) VALUES ('aud_integrity_'||md5(clock_timestamp()::text||random()::text),clock_timestamp(),'SYSTEM','FILE_INTEGRITY_CHECK','SYSTEM','FAILURE','数据库恢复后的附件一致性检查发现异常或未能完成；详情见 file-integrity-report.json','integrity_'||md5(clock_timestamp()::text));" >/dev/null; then
      echo "附件检查失败日志写入数据库失败，请同时保留本次终端输出。" >&2
    fi
  fi
  docker compose exec -T postgres psql --username="${POSTGRES_USER:-migra}" --dbname="${POSTGRES_DB:-migra}" -c "INSERT INTO audit_logs (id,occurred_at,actor_username_snapshot,action,entity_type,result,summary,request_id) VALUES ('aud_restore_'||md5(clock_timestamp()::text||random()::text),clock_timestamp(),'SYSTEM','DATABASE_RESTORE','SYSTEM','SUCCESS','PostgreSQL 数据库恢复完成；附件检查结果见 file-integrity-report.json','restore_'||md5(clock_timestamp()::text));" >/dev/null
fi
docker compose start migra
app_stopped=0
exit "$restore_status"

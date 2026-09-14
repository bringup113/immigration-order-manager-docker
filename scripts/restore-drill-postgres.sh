#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" || "$1" != *.dump ]]; then
  echo "用法：./scripts/restore-drill-postgres.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump" >&2
  exit 2
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
backup_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
restore_database="migra_restore_$(date -u +%Y%m%d%H%M%S)_$$"
postgres_user="${POSTGRES_USER:-migra}"
cd "$project_root"

cleanup() {
  docker compose exec -T postgres dropdb --if-exists --force --username="$postgres_user" "$restore_database" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

./scripts/verify-postgres-backup.sh "$backup_file"
echo "创建隔离恢复数据库：$restore_database"
docker compose exec -T postgres createdb --username="$postgres_user" "$restore_database"
docker compose exec -T postgres pg_restore \
  --username="$postgres_user" \
  --dbname="$restore_database" \
  --exit-on-error \
  --no-owner \
  --no-privileges < "$backup_file"

docker compose run --rm --no-deps \
  -e POSTGRES_DB="$restore_database" \
  postgres_migrate
docker compose exec -T \
  -e RESTORE_DATABASE="$restore_database" \
  migra sh -eu -c '
    restore_url="${DATABASE_URL%/*}/${RESTORE_DATABASE}"
    DATABASE_URL="$restore_url" UPLOAD_ROOT=/app/data/files \
      node scripts/check-file-integrity.mjs \
      --output /tmp/restore-drill-integrity.json >/dev/null
  '

stats="$(docker compose exec -T postgres psql --username="$postgres_user" --dbname="$restore_database" --tuples-only --no-align --field-separator='|' --command="
  SELECT
    (SELECT count(*) FROM _app_migrations),
    (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'),
    (SELECT count(*) FROM projects),
    (SELECT count(*) FROM exchange_rates),
    (SELECT count(*) FROM project_step_templates),
    (SELECT count(*) FROM project_material_templates),
    (SELECT count(*) FROM project_plan_templates),
    (SELECT count(*) FROM orders),
    (SELECT count(*) FROM users),
    (SELECT count(*) FROM material_files);
")"
IFS='|' read -r migration_count table_count project_count currency_count step_template_count material_template_count plan_template_count order_count user_count file_count <<< "$(echo "$stats" | tr -d '[:space:]')"
expected_migrations="$(find postgres/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
if [[ "$migration_count" -ne "$expected_migrations" || "$table_count" -lt 1 ]]; then
  echo "恢复校验失败：迁移或业务表数量不正确。" >&2
  exit 1
fi

echo "隔离恢复成功：迁移 ${migration_count}/${expected_migrations}，业务表 ${table_count}，项目 ${project_count}，币种 ${currency_count}，流程模板 ${step_template_count}，材料模板 ${material_template_count}，收付款模板 ${plan_template_count}，订单 ${order_count}，用户 ${user_count}，文件记录 ${file_count}。"
echo "文件一致性检查已通过；上传文件没有写入数据库备份。"

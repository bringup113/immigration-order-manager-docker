#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

configured_user="$(docker inspect migra-order-manager --format '{{.Config.User}}')"
if [[ -z "$configured_user" || "$configured_user" == "root" || "$configured_user" == "0" || "$configured_user" == 0:* ]]; then
  echo "应用容器仍以 root 配置运行。" >&2
  exit 1
fi

docker compose exec -T migra sh -c '
  touch /app/data/.security-write-probe
  rm /app/data/.security-write-probe
  if touch /app/server.js 2>/dev/null; then
    echo "应用代码目录可写，不符合要求。" >&2
    exit 1
  fi
'

docker compose exec -T migra node -e '
const pg=require("pg");
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
client.connect()
  .then(()=>client.query("SELECT current_user,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user"))
  .then(({rows})=>{
    const role=rows[0];
    if(role.current_user!=="migra_runtime"||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolbypassrls) process.exitCode=1;
    else console.log("Web 数据库账号最小权限通过："+role.current_user);
  })
  .finally(()=>client.end());
'

backup_role="$(docker compose exec -T postgres_backup psql --tuples-only --no-align --command='SELECT current_user')"
if [[ "$backup_role" != "migra_backup" ]]; then
  echo "备份容器没有使用 migra_backup。" >&2
  exit 1
fi
if docker compose exec -T postgres_backup psql --command="UPDATE orders SET updated_at=updated_at WHERE false" >/dev/null 2>&1; then
  echo "备份账号意外拥有业务写权限。" >&2
  exit 1
fi

echo "部署权限校验通过：容器非 root、代码只读、数据目录可写、runtime 非超级用户、backup 只读。"

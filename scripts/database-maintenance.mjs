import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("缺少环境变量：" + name);
  return value;
}
function identifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error("PostgreSQL 角色或数据库名称不合法。");
  return '"' + value.replaceAll('"', '""') + '"';
}
function literal(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}
function databaseUrl(user, password, database) {
  return "postgresql://" + encodeURIComponent(user) + ":" + encodeURIComponent(password) + "@" +
    (process.env.POSTGRES_HOST || "postgres") + ":" + (process.env.POSTGRES_PORT || "5432") + "/" + encodeURIComponent(database);
}

const database = required("POSTGRES_DB");
const ownerUser = required("POSTGRES_USER");
const ownerPassword = required("POSTGRES_PASSWORD");
const migratorUser = required("POSTGRES_MIGRATOR_USER");
const migratorPassword = required("POSTGRES_MIGRATOR_PASSWORD");
const runtimeUser = required("POSTGRES_RUNTIME_USER");
const runtimePassword = required("POSTGRES_RUNTIME_PASSWORD");
const backupUser = required("POSTGRES_BACKUP_USER");
const backupPassword = required("POSTGRES_BACKUP_PASSWORD");
const directory = resolve(process.env.POSTGRES_MIGRATIONS_DIR || join(process.cwd(), "postgres", "migrations"));
if (!existsSync(directory)) throw new Error("找不到 PostgreSQL 升级文件：" + directory);

async function withOwner(callback) {
  const client = new pg.Client({ connectionString: databaseUrl(ownerUser, ownerPassword, database) });
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

await withOwner(async (owner) => {
  for (const [role, password] of [
    [migratorUser, migratorPassword],
    [runtimeUser, runtimePassword],
    [backupUser, backupPassword],
  ]) {
    const found = await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (!found.rowCount) await owner.query("CREATE ROLE " + identifier(role) + " LOGIN PASSWORD " + literal(password));
    await owner.query("ALTER ROLE " + identifier(role) + " LOGIN PASSWORD " + literal(password) +
      " NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  }
  await owner.query("ALTER DATABASE " + identifier(database) + " OWNER TO " + identifier(migratorUser));
  await owner.query("ALTER SCHEMA public OWNER TO " + identifier(migratorUser));
  const objectSql = [
    "SELECT c.relkind,n.nspname,c.relname",
    "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
    "WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f')",
    "AND pg_get_userbyid(c.relowner)=$1",
    "ORDER BY c.relkind,c.relname",
  ].join(" ");
  const objects = await owner.query(objectSql, [ownerUser]);
  const kinds = { r: "TABLE", p: "TABLE", S: "SEQUENCE", v: "VIEW", m: "MATERIALIZED VIEW", f: "FOREIGN TABLE" };
  for (const item of objects.rows) {
    await owner.query("ALTER " + kinds[item.relkind] + " " + identifier(item.nspname) + "." + identifier(item.relname) +
      " OWNER TO " + identifier(migratorUser));
  }
  await owner.query("REVOKE ALL ON DATABASE " + identifier(database) + " FROM PUBLIC");
  await owner.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await owner.query("GRANT CONNECT ON DATABASE " + identifier(database) + " TO " + identifier(migratorUser));
  await owner.query("GRANT USAGE,CREATE ON SCHEMA public TO " + identifier(migratorUser));
});

const migrator = new pg.Client({ connectionString: databaseUrl(migratorUser, migratorPassword, database) });
await migrator.connect();
let appliedCount = 0;
try {
  await migrator.query("SELECT pg_advisory_lock(hashtext('migra_schema_migrations'))");
  await migrator.query("CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL)");
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    const applied = await migrator.query("SELECT 1 FROM _app_migrations WHERE name=$1", [name]);
    if (applied.rowCount) continue;
    await migrator.query("BEGIN");
    try {
      await migrator.query(readFileSync(join(directory, name), "utf8"));
      await migrator.query("INSERT INTO _app_migrations (name,applied_at) VALUES ($1,$2)", [name, new Date().toISOString()]);
      await migrator.query("COMMIT");
      appliedCount += 1;
    } catch (error) {
      await migrator.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await migrator.query("SELECT pg_advisory_unlock(hashtext('migra_schema_migrations'))").catch(() => undefined);
  await migrator.end();
}

await withOwner(async (owner) => {
  for (const role of [runtimeUser, backupUser]) {
    await owner.query("GRANT CONNECT ON DATABASE " + identifier(database) + " TO " + identifier(role));
    await owner.query("GRANT USAGE ON SCHEMA public TO " + identifier(role));
  }
  await owner.query("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO " + identifier(runtimeUser));
  await owner.query("GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO " + identifier(runtimeUser));
  await owner.query("REVOKE UPDATE,DELETE,TRUNCATE ON TABLE audit_logs FROM " + identifier(runtimeUser));
  await owner.query("REVOKE UPDATE,DELETE,TRUNCATE ON TABLE order_closure_events FROM " + identifier(runtimeUser));
  await owner.query("REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON TABLE _app_migrations FROM " + identifier(runtimeUser));
  await owner.query("GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + identifier(backupUser));
  await owner.query("GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO " + identifier(backupUser));
  await owner.query("ALTER DEFAULT PRIVILEGES FOR ROLE " + identifier(migratorUser) +
    " IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO " + identifier(runtimeUser));
  await owner.query("ALTER DEFAULT PRIVILEGES FOR ROLE " + identifier(migratorUser) +
    " IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO " + identifier(runtimeUser));
  await owner.query("ALTER DEFAULT PRIVILEGES FOR ROLE " + identifier(migratorUser) +
    " IN SCHEMA public GRANT SELECT ON TABLES TO " + identifier(backupUser));
  await owner.query("ALTER DEFAULT PRIVILEGES FOR ROLE " + identifier(migratorUser) +
    " IN SCHEMA public GRANT SELECT ON SEQUENCES TO " + identifier(backupUser));
});

process.stdout.write("数据库角色与迁移完成：本次应用 " + appliedCount + " 个迁移。\n");

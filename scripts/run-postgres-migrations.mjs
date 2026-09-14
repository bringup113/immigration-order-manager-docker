import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少 MIGRATION_DATABASE_URL 或 DATABASE_URL。");
const directory = resolve(process.env.POSTGRES_MIGRATIONS_DIR || join(process.cwd(), "postgres", "migrations"));
if (!existsSync(directory)) throw new Error("找不到 PostgreSQL 升级文件：" + directory);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let appliedCount = 0;
try {
  await client.query("SELECT pg_advisory_lock(hashtext('migra_schema_migrations'))");
  await client.query("CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL)");
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    const applied = await client.query("SELECT 1 FROM _app_migrations WHERE name=$1", [name]);
    if (applied.rowCount) continue;
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(join(directory, name), "utf8"));
      await client.query("INSERT INTO _app_migrations (name,applied_at) VALUES ($1,$2)", [name, new Date().toISOString()]);
      await client.query("COMMIT");
      appliedCount += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('migra_schema_migrations'))").catch(() => undefined);
  await client.end();
}

process.stdout.write("PostgreSQL 迁移完成：本次应用 " + appliedCount + " 个迁移。\n");

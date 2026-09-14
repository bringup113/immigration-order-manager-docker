import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import type { PoolClient, QueryResult } from "pg";
import type { AppDatabase, AppPreparedStatement, DatabaseRow, DatabaseRunResult } from "./driver";

const { Pool, types } = pg;

// Keep the database boundary stable for the rest of the application: business
// DATE values remain YYYY-MM-DD strings, while TIMESTAMPTZ values are ISO strings.
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1184, (value) => new Date(value).toISOString());

function envInteger(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function placeholders(sql: string) {
  let index = 0;
  let quote: "'" | '"' | null = null;
  let result = "";
  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const character = sql[cursor];
    if (quote) {
      result += character;
      if (character === quote && sql[cursor + 1] === quote) {
        result += sql[cursor + 1];
        cursor += 1;
      } else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
      result += character;
    } else if (character === "?") {
      index += 1;
      result += `$${index}`;
    } else result += character;
  }
  return result;
}

class PostgresPreparedStatement implements AppPreparedStatement {
  constructor(readonly database: PostgresDatabase, readonly sql: string, readonly values: unknown[] = [], readonly client?: PoolClient) {}

  bind(...values: unknown[]) {
    return new PostgresPreparedStatement(this.database, this.sql, values, this.client);
  }

  async execute(client?: PoolClient): Promise<QueryResult<DatabaseRow>> {
    await this.database.ready;
    const executor = client ?? this.client ?? this.database.pool;
    const started = performance.now();
    try {
      const sql=placeholders(this.sql);
      const values=this.values.map(value=>value===undefined?null:value);
      return executor===this.database.pool ? await this.database.pool.query(sql,values)
        : await this.database.queryOnClient(executor as PoolClient,sql,values);
    } finally {
      const elapsed = Math.round(performance.now() - started);
      if (elapsed >= envInteger("DB_SLOW_QUERY_MS", 500, 1, 60000)) {
        console.warn(JSON.stringify({ event: "slow_query", durationMs: elapsed, operation: this.sql.trim().split(/\s+/)[0], waiting: this.database.pool.waitingCount }));
      }
    }
  }

  async all<T = DatabaseRow>() {
    const result = await this.execute();
    return { results: result.rows as T[], success: true };
  }

  async first<T = DatabaseRow>() {
    const result = await this.execute();
    return (result.rows[0] as T | undefined) ?? null;
  }

  async run(): Promise<DatabaseRunResult> {
    const result = await this.execute();
    return { success: true, meta: { changes: result.rowCount ?? 0 } };
  }
}

class PostgresDatabase implements AppDatabase {
  readonly dialect = "postgres" as const;
  readonly pool: InstanceType<typeof Pool>;
  readonly ready: Promise<void>;
  private readonly clientQueues=new WeakMap<PoolClient,Promise<unknown>>();

  queryOnClient(client:PoolClient,sql:string,values:unknown[]):Promise<QueryResult<DatabaseRow>> {
    const previous=this.clientQueues.get(client) || Promise.resolve();
    const next=previous.then(()=>client.query(sql,values));
    this.clientQueues.set(client,next.catch(()=>undefined));
    return next;
  }

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: envInteger("DB_POOL_MAX", 5, 1, 30),
      connectionTimeoutMillis: envInteger("DB_CONNECTION_TIMEOUT_MS", 3000, 100, 60000),
      idleTimeoutMillis: 30000,
      statement_timeout: envInteger("DB_STATEMENT_TIMEOUT_MS", 15000, 1000, 120000),
      idle_in_transaction_session_timeout: 30000,
      application_name: "migra",
    });
    this.pool.on("error", (error) => console.error("PostgreSQL idle connection error", error.message));
    this.ready = process.env.SKIP_DATABASE_MIGRATIONS === "1" ? Promise.resolve() : this.applyMigrations();
  }

  prepare(sql: string) {
    return new PostgresPreparedStatement(this, sql);
  }

  async batch(statements: AppPreparedStatement[]) {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const results: DatabaseRunResult[] = [];
      results.push(...await this.executeBatch(statements, client));
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async transaction<T>(callback: (database: AppDatabase) => Promise<T>) {
    await this.ready;
    const client = await this.pool.connect();
    const transactionDatabase: AppDatabase = {
      dialect: "postgres",
      prepare: (sql) => new PostgresPreparedStatement(this, sql, [], client),
      batch: async (statements) => {
        return this.executeBatch(statements, client);
      },
      transaction: async (nestedCallback) => nestedCallback(transactionDatabase),
    };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const value = await callback(transactionDatabase);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async executeBatch(statements: AppPreparedStatement[], client: PoolClient) {
    const results: DatabaseRunResult[] = [];
    for (let index=0; index<statements.length;) {
      const first=statements[index];
      if (!(first instanceof PostgresPreparedStatement)) throw new Error("Unsupported PostgreSQL statement");
      // Only combine consecutive, plain INSERTs. Keep order, literals and per-statement result semantics.
      const match=/^(INSERT INTO [a-z_]+ \([^()]+\) VALUES )\(([^()]+)\)$/i.exec(first.sql);
      const group=[first];
      if(match) while(group.length<100 && index+group.length<statements.length) {
        const next=statements[index+group.length];
        if(!(next instanceof PostgresPreparedStatement) || next.sql!==first.sql)break;
        group.push(next);
      }
      const sql=match && group.length>1 ? match[1]+group.map(()=>`(${match[2]})`).join(",") : first.sql;
      const result=await this.queryOnClient(client,placeholders(sql),group.flatMap(item=>item.values.map(value=>value===undefined?null:value)));
      if(group.length===1)results.push({success:true,meta:{changes:result.rowCount ?? 0}});
      else results.push(...group.map(()=>({success:true,meta:{changes:1}})));
      index+=group.length;
    }
    return results;
  }

  private async applyMigrations() {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('migra_schema_migrations'))");
      await client.query("CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL)");
      const directory = resolve(process.env.POSTGRES_MIGRATIONS_DIR || join(process.cwd(), "postgres", "migrations"));
      if (!existsSync(directory)) throw new Error(`找不到 PostgreSQL 升级文件：${directory}`);
      for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
        const applied = await client.query("SELECT 1 FROM _app_migrations WHERE name=$1", [name]);
        if (applied.rowCount) continue;
        await client.query("BEGIN");
        try {
          await client.query(readFileSync(join(directory, name), "utf8"));
          await client.query("INSERT INTO _app_migrations (name,applied_at) VALUES ($1,$2)", [name, new Date().toISOString()]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('migra_schema_migrations'))").catch(() => undefined);
      client.release();
    }
  }
}

let singleton: AppDatabase | null = null;

export function getPlatformDatabase(): AppDatabase {
  if (singleton) return singleton;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("PostgreSQL 连接地址尚未设置。");
  singleton = new PostgresDatabase(databaseUrl);
  return singleton;
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { orderSortSql } from "../lib/order-sort.ts";

const databaseUrl =
  process.env.MIGRA_SORT_TEST_DATABASE_URL || process.env.MIGRA_DATABASE_URL;

test("database order sorting preserves ties, null placement and pagination", {
  skip: !databaseUrl,
}, async () => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query(`CREATE TEMP TABLE orders (
      id text, owner_user_id text, signed_at date, created_at timestamptz, updated_at timestamptz);
      INSERT INTO orders VALUES
      ('a','owner','2026-01-01','2026-03-01','2026-06-01'),
      ('b','owner','2026-02-01','2026-01-01','2026-02-01'),
      ('c','owner','2026-02-01','2026-01-01','2026-03-01'),
      ('d','owner',NULL,'2026-04-01','2026-04-01');`);
    await db.query(readFileSync(new URL("../postgres/migrations/0025_order_signed_sort.sql", import.meta.url), "utf8"));
    const expected = {
      signed_desc: ["c", "b", "a", "d"],
      signed_asc: ["a", "b", "c", "d"],
      created_desc: ["d", "a", "c", "b"],
      updated_desc: ["a", "d", "c", "b"],
    };
    for (const [mode, ids] of Object.entries(expected)) {
      const actual = [];
      for (const offset of [0, 2]) {
        const result = await db.query(`WITH page AS MATERIALIZED (
          SELECT o.* FROM orders o WHERE owner_user_id=$1 ORDER BY ${orderSortSql(mode)} LIMIT 2 OFFSET $2
        ) SELECT o.id FROM page o ORDER BY ${orderSortSql(mode)}`, ["owner", offset]);
        actual.push(...result.rows.map(row => row.id));
      }
      assert.deepEqual(actual, ids, mode);
    }
  } finally {
    await db.end();
  }
});

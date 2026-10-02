import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { queryIdentifier } from "../lib/query-observability.ts";

test("slow-query identifiers are stable across formatting and contain no parameters", () => {
  const compact = queryIdentifier("SELECT id FROM orders WHERE order_no = ?");
  const formatted = queryIdentifier("  select  id\nFROM orders   WHERE order_no = ?  ");
  assert.equal(compact, formatted);
  assert.match(compact, /^[a-f0-9]{12}$/);
  assert.equal(compact.includes("orders"), false);
});

test("performance projections avoid unused detail, dashboard, and mobile-list work", () => {
  const detail = readFileSync("lib/order-detail-query.ts", "utf8");
  const dashboard = readFileSync("lib/dashboard-query.ts", "utf8");
  const orders = readFileSync("lib/order-list.ts", "utf8");
  assert.match(detail, /const includeSteps = workflow \|\| overview/);
  assert.match(detail, /const includeMrz = section === "people" \|\| section === "all"/);
  assert.match(detail, /!includeSteps && !mobileSurface/);
  assert.match(dashboard, /canReadOrders && includeSummary/);
  assert.match(dashboard, /reminderRange && includeSummary/);
  assert.match(orders, /hasPermission\(user, "finance\.read"\) && !mobileSurface/);
});

test("order search writes only permission-scoped blobs after the legacy migration", () => {
  const search = readFileSync("lib/order-search.ts", "utf8");
  const migration = readFileSync(
    "postgres/migrations/0027_remove_legacy_order_search_columns.sql",
    "utf8",
  );
  const orderInsert = search.slice(
    search.indexOf("INSERT INTO order_search_index"),
    search.indexOf("export function searchTerms"),
  );
  for (const legacy of ["source_version", "search_text", "search_pinyin", "search_initials", "search_blob"])
    assert.equal(orderInsert.includes(legacy), false, legacy);
  assert.match(migration, /DROP INDEX IF EXISTS order_search_index_blob_trgm_idx/);
  assert.match(migration, /DROP COLUMN IF EXISTS search_blob/);
});

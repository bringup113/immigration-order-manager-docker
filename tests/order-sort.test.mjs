import test from "node:test";
import assert from "node:assert/strict";
import { orderSortSql } from "../lib/order-sort.ts";

test("order sorting defaults safely and only permits fixed SQL expressions", () => {
  const fallback = "o.signed_at DESC NULLS LAST,o.created_at DESC,o.id DESC";
  for (const value of [null, "", "signed_desc", "unknown", "id; DROP TABLE orders"]) {
    assert.equal(orderSortSql(value), fallback);
  }
  assert.equal(orderSortSql("signed_asc"), "o.signed_at ASC NULLS LAST,o.created_at ASC,o.id ASC");
  assert.equal(orderSortSql("created_desc"), "o.created_at DESC,o.id DESC");
  assert.equal(orderSortSql("updated_desc"), "o.updated_at DESC,o.id DESC");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DATA_RESOURCE_POLICIES,
  getDataResourcePolicy,
} from "../lib/data-resource-policy.ts";

test("every implemented generic data resource has an explicit policy", () => {
  const route = readFileSync("app/api/data/[resource]/route.ts", "utf8");
  const implemented = new Set(
    [...route.matchAll(/resource\s*===\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    ),
  );
  assert.ok(implemented.size > 0, "no generic data resources were found");
  for (const resource of implemented) {
    assert.ok(
      Object.hasOwn(DATA_RESOURCE_POLICIES, resource),
      `${resource} has no resource policy`,
    );
  }
});

test("every writable generic data resource defines permission and audit metadata", () => {
  for (const resource of [
    "orders",
    "agents",
    "channels",
    "projects",
    "rates",
  ]) {
    const policy = getDataResourcePolicy(resource);
    assert.ok(policy?.writePermission, `${resource} has no write permission`);
    assert.ok(policy?.entityType, `${resource} has no audit entity type`);
    assert.ok(policy?.summary, `${resource} has no audit summary`);
  }
});

test("generic data snapshot sources are fixed internal table names", () => {
  assert.deepEqual(getDataResourcePolicy("agents")?.snapshot, {
    table: "agents",
    key: "id",
  });
  assert.deepEqual(getDataResourcePolicy("rates")?.snapshot, {
    table: "exchange_rates",
    key: "currency",
  });
  assert.equal(getDataResourcePolicy("orders")?.snapshot, undefined);
  assert.equal(getDataResourcePolicy("unknown"), null);
});

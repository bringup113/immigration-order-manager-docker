import assert from "node:assert/strict";
import test from "node:test";
import { validPermissions } from "../lib/permissions.ts";

test("write permissions automatically include their read dependencies", () => {
  const permissions = new Set(validPermissions(["finance.write", "materials.write", "users.write"]));
  for (const expected of ["finance.read", "materials.read", "orders.read", "users.read", "roles.read"]) {
    assert.equal(permissions.has(expected), true, `${expected} should be included`);
  }
});

test("unknown permissions are rejected", () => {
  assert.deepEqual(validPermissions(["orders.read", "system.shell", 123]).sort(), ["orders.read"]);
});

test("download-only material roles still receive preview and order access", () => {
  assert.deepEqual(new Set(validPermissions(["materials.download"])), new Set(["materials.download", "materials.read", "orders.read"]));
});

test("workflow override permission includes normal order access", () => {
  assert.deepEqual(new Set(validPermissions(["orders.override"])), new Set(["orders.override", "orders.write", "orders.read"]));
});

test("order assignment and task writes include their required read access", () => {
  assert.deepEqual(new Set(validPermissions(["orders.assign"])), new Set(["orders.assign", "orders.write", "orders.read"]));
  assert.deepEqual(new Set(validPermissions(["tasks.write"])), new Set(["tasks.write", "tasks.read", "orders.read"]));
});

test("project package permissions include safe project dependencies", () => {
  assert.deepEqual(new Set(validPermissions(["projects.export"])), new Set(["projects.export", "projects.read"]));
  assert.deepEqual(new Set(validPermissions(["projects.import"])), new Set(["projects.import", "projects.write", "projects.read"]));
});

test("MRZ confirmation includes applicant, material, and order write access", () => {
  assert.deepEqual(new Set(validPermissions(["applicants.mrz"])), new Set(["applicants.mrz", "applicants.write", "materials.write", "materials.read", "orders.write", "orders.read"]));
});

test("restoring historical finance and material records includes write and read access", () => {
  assert.deepEqual(new Set(validPermissions(["finance.restore"])), new Set(["finance.restore", "finance.write", "finance.read", "orders.read"]));
  assert.deepEqual(new Set(validPermissions(["materials.restore"])), new Set(["materials.restore", "materials.write", "materials.read", "orders.read"]));
});

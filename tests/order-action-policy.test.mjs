import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORDER_ACTION_POLICIES,
  getOrderActionPolicy,
  orderActionAuditCode,
} from "../lib/order-action-policy.ts";

test("every implemented order action has an explicit permission and audit policy", () => {
  const route = readFileSync("app/api/orders/[orderNo]/route.ts", "utf8");
  const implemented = new Set(
    [...route.matchAll(/action\s*===\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    ),
  );

  assert.ok(implemented.size > 0, "no order actions were found in the route");
  for (const action of implemented) {
    assert.ok(
      Object.hasOwn(ORDER_ACTION_POLICIES, action),
      `${action} has no explicit order action policy`,
    );
  }
  for (const action of Object.keys(ORDER_ACTION_POLICIES)) {
    assert.ok(
      implemented.has(action),
      `${action} policy has no implemented action`,
    );
  }
});

test("privileged order actions keep their dedicated permissions", () => {
  assert.equal(getOrderActionPolicy("assignOwner").permission, "orders.assign");
  assert.equal(
    getOrderActionPolicy("reopenOrder").permission,
    "orders.override",
  );
  assert.equal(getOrderActionPolicy("confirmMrz").permission, "applicants.mrz");
  assert.equal(
    getOrderActionPolicy("restoreCashEntry").permission,
    "finance.restore",
  );
});

test("order task, cash history, closure, and MRZ audit codes remain stable", () => {
  assert.equal(orderActionAuditCode("saveTask"), "TASK_CREATE");
  assert.equal(
    orderActionAuditCode("saveTask", { taskId: "task-1" }),
    "TASK_UPDATE",
  );
  assert.equal(
    orderActionAuditCode("toggleTask", { taskStatus: "COMPLETED" }),
    "TASK_COMPLETE",
  );
  assert.equal(orderActionAuditCode("toggleTask"), "TASK_REOPEN");
  assert.equal(orderActionAuditCode("deleteTask"), "TASK_DELETE");
  assert.equal(orderActionAuditCode("voidCashEntry"), "CASH_ENTRY_VOID");
  assert.equal(orderActionAuditCode("restoreCashEntry"), "CASH_ENTRY_RESTORE");
  assert.equal(orderActionAuditCode("closeOrder"), "ORDER_CLOSE");
  assert.equal(orderActionAuditCode("reopenOrder"), "ORDER_REOPEN");
  assert.equal(orderActionAuditCode("confirmMrz"), "APPLICANT_MRZ_CONFIRM");
});

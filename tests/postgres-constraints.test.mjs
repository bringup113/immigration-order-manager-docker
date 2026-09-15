import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.MIGRA_DATABASE_URL;
const enabled = Boolean(databaseUrl);

async function client() {
  const connection = new pg.Client({ connectionString: databaseUrl });
  await connection.connect();
  return connection;
}

async function expectTransactionFailure(work, expectedCode) {
  const connection = await client();
  try {
    await connection.query("BEGIN");
    await assert.rejects(async () => {
      await work(connection);
      await connection.query("COMMIT");
    }, (error) => error?.code === expectedCode);
  } finally {
    await connection.query("ROLLBACK").catch(() => undefined);
    await connection.end();
  }
}

test("business dates and system timestamps use native PostgreSQL types", { skip: !enabled }, async () => {
  const connection = await client();
  try {
    const result = await connection.query(`SELECT table_name,column_name,data_type
      FROM information_schema.columns
      WHERE (table_name,column_name) IN (
        ('orders','signed_at'),('order_steps','due_date'),('order_cash_entries','entry_date'),
        ('order_tasks','due_date'),('order_tasks','completed_at'),('orders','updated_at'),
        ('users','last_login_at'),('audit_logs','occurred_at'))`);
    const types = new Map(result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
    assert.equal(types.get("orders.signed_at"), "date");
    assert.equal(types.get("order_steps.due_date"), "date");
    assert.equal(types.get("order_cash_entries.entry_date"), "date");
    assert.equal(types.get("order_tasks.due_date"), "date");
    assert.equal(types.get("order_tasks.completed_at"), "timestamp with time zone");
    assert.equal(types.get("orders.updated_at"), "timestamp with time zone");
    assert.equal(types.get("users.last_login_at"), "timestamp with time zone");
    assert.equal(types.get("audit_logs.occurred_at"), "timestamp with time zone");
  } finally { await connection.end(); }
});

test("role order scope only accepts ALL or OWN", { skip: !enabled }, async () => {
  await expectTransactionFailure((connection) => connection.query("UPDATE roles SET order_scope='TEAM' WHERE id='role_readonly'"), "23514");
});

test("order task status, completion time, and relation fields stay consistent", { skip: !enabled }, async () => {
  const probe = await client();
  const source = await probe.query("SELECT o.id AS order_id,o.owner_user_id FROM orders o LIMIT 1");
  await probe.end();
  assert.equal(source.rowCount, 1, "隔离集成测试夹具缺少订单");
  const row = source.rows[0];
  await expectTransactionFailure((connection) => connection.query(`INSERT INTO order_tasks
    (id,order_id,title,due_date,priority,status,owner_user_id,completed_at,created_at,updated_at)
    VALUES ('test_invalid_task_status',$1,'非法完成状态',CURRENT_DATE,'MEDIUM','COMPLETED',$2,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [row.order_id, row.owner_user_id]), "23514");
  await expectTransactionFailure((connection) => connection.query(`INSERT INTO order_tasks
    (id,order_id,title,due_date,priority,status,owner_user_id,related_type,related_id,created_at,updated_at)
    VALUES ('test_invalid_task_relation',$1,'非法关联',CURRENT_DATE,'MEDIUM','OPEN',$2,'STEP',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [row.order_id, row.owner_user_id]), "23514");
  await expectTransactionFailure((connection) => connection.query(`INSERT INTO order_tasks
    (id,order_id,title,due_date,priority,status,owner_user_id,created_at,updated_at)
    VALUES ('test_invalid_task_date',$1,'非法日期',$2,'MEDIUM','OPEN',$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [row.order_id, "2026-02-30", row.owner_user_id]), "22008");
});

test("PostgreSQL rejects an impossible business date", { skip: !enabled }, async () => {
  await expectTransactionFailure(async (connection) => {
    const order = await connection.query("SELECT id FROM orders LIMIT 1");
    if (!order.rowCount) return connection.query("SELECT '2026-02-30'::date");
    await connection.query("UPDATE orders SET signed_at=$1 WHERE id=$2", ["2026-02-30", order.rows[0].id]);
  }, "22008");
});

test("a single order cannot have two in-progress steps", { skip: !enabled }, async () => {
  const probe = await client();
  const order = await probe.query("SELECT order_id FROM order_steps GROUP BY order_id HAVING count(*)>=2 LIMIT 1");
  await probe.end();
  assert.equal(order.rowCount, 1, "隔离集成测试夹具缺少包含两个流程的订单");
  await expectTransactionFailure(async (connection) => {
    const steps = await connection.query("SELECT id FROM order_steps WHERE order_id=$1 ORDER BY sequence LIMIT 2", [order.rows[0].order_id]);
    await connection.query("UPDATE order_steps SET status='PENDING' WHERE order_id=$1", [order.rows[0].order_id]);
    await connection.query("UPDATE order_steps SET status='IN_PROGRESS' WHERE id=$1", [steps.rows[0].id]);
    await connection.query("UPDATE order_steps SET status='IN_PROGRESS' WHERE id=$1", [steps.rows[1].id]);
  }, "23505");
});

test("required workflow steps cannot be skipped without a reason", { skip: !enabled }, async () => {
  const probe = await client();
  const step = await probe.query("SELECT id FROM order_steps WHERE required=1 LIMIT 1");
  await probe.end();
  assert.equal(step.rowCount, 1, "隔离集成测试夹具缺少必办流程");
  await expectTransactionFailure((connection) => connection.query("UPDATE order_steps SET status='SKIPPED',skip_reason=NULL WHERE id=$1", [step.rows[0].id]), "23514");
});

test("sensitive order statuses require a reason", { skip: !enabled }, async () => {
  const probe = await client();
  const order = await probe.query("SELECT id FROM orders LIMIT 1");
  await probe.end();
  assert.equal(order.rowCount, 1, "隔离集成测试夹具缺少订单");
  await expectTransactionFailure((connection) => connection.query("UPDATE orders SET status='CANCELLED',status_reason=NULL WHERE id=$1", [order.rows[0].id]), "23514");
});

test("cash void state and completed-order closure fields stay consistent", { skip: !enabled }, async () => {
  const probe = await client();
  const cash = await probe.query("SELECT id FROM order_cash_entries LIMIT 1");
  const order = await probe.query("SELECT id FROM orders LIMIT 1");
  await probe.end();
  assert.equal(cash.rowCount, 1, "隔离集成测试夹具缺少收付款记录");
  assert.equal(order.rowCount, 1, "隔离集成测试夹具缺少订单");
  await expectTransactionFailure((connection) => connection.query("UPDATE order_cash_entries SET status='VOIDED',void_reason=NULL,voided_at=NULL,voided_by=NULL WHERE id=$1", [cash.rows[0].id]), "23514");
  await expectTransactionFailure((connection) => connection.query("UPDATE orders SET status='COMPLETED',closed_on=NULL,closure_result=NULL,closed_at=NULL,closed_by=NULL WHERE id=$1", [order.rows[0].id]), "23514");
});

test("material file status and SHA-256 format are constrained", { skip: !enabled }, async () => {
  const probe = await client();
  const file = await probe.query("SELECT id FROM material_files LIMIT 1");
  await probe.end();
  assert.equal(file.rowCount, 1, "隔离集成测试夹具缺少材料文件记录");
  await expectTransactionFailure((connection) => connection.query("UPDATE material_files SET status='UNKNOWN' WHERE id=$1", [file.rows[0].id]), "23514");
  await expectTransactionFailure((connection) => connection.query("UPDATE material_files SET sha256='bad-hash' WHERE id=$1", [file.rows[0].id]), "23514");
});

test("a failed audit insert rolls back its business mutation", { skip: !enabled }, async () => {
  const connection = await client();
  try {
    const selected = await connection.query("SELECT id,notes FROM orders LIMIT 1");
    assert.equal(selected.rowCount, 1, "隔离集成测试夹具缺少订单");
    const order = selected.rows[0];
    await connection.query("BEGIN");
    await connection.query("UPDATE orders SET notes='audit rollback sentinel' WHERE id=$1", [order.id]);
    await assert.rejects(() => connection.query(`INSERT INTO audit_logs
      (id,occurred_at,action,entity_type,result,summary,request_id)
      VALUES ('test_invalid_audit',CURRENT_TIMESTAMP,'TEST','ORDER','INVALID','must fail','test')`), (error) => error?.code === "23514");
    await connection.query("ROLLBACK");
    const after = await connection.query("SELECT notes FROM orders WHERE id=$1", [order.id]);
    assert.equal(after.rows[0].notes, order.notes);
  } finally {
    await connection.query("ROLLBACK").catch(() => undefined);
    await connection.end();
  }
});

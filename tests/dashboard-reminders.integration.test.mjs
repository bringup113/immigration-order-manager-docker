import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const databaseUrl =
  process.env.MIGRA_REMINDER_TEST_DATABASE_URL || process.env.MIGRA_DATABASE_URL;

test("finance reminders follow active allocations in plan currency", {
  skip: !databaseUrl,
}, async () => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // Session-local tables shadow real tables; no application data is modified.
    await db.query(`
      CREATE TEMP TABLE orders (id text, order_no text, project_name_snapshot text, status text);
      CREATE TEMP TABLE order_applicants (order_id text, name text, applicant_type text, sequence int);
      CREATE TEMP TABLE order_plans (id text, order_id text, plan_type text, due_date date, name text, planned_amount_minor bigint, planned_base_minor bigint);
      CREATE TEMP TABLE order_cash_entries (order_plan_id text, order_id text, status text, direction text, plan_amount_minor bigint, base_amount_minor bigint);
      INSERT INTO orders VALUES ('o','TEST','Test','ACTIVE');
    `);
    const source = readFileSync(new URL("../lib/dashboard-query.ts", import.meta.url), "utf8");
    const start = source.indexOf("SELECT CASE op.plan_type");
    const end = source.indexOf("UNION ALL SELECT '办理流程'", start);
    assert.ok(start > 0 && end > start);
    const query = source.slice(start, end)
      .replaceAll("${canReadFinance}", "TRUE")
      .replaceAll("${orderScope.sql}", "o.id='o'")
      .replaceAll("${sevenDays}", "CURRENT_DATE + 7");
    const visible = async () => (await db.query(query)).rows.map(row => row.title).sort();
    for (const [kind, direction] of [["RECEIVABLE", "RECEIPT"], ["PAYABLE", "PAYMENT"]]) {
      await db.query("TRUNCATE order_plans, order_cash_entries");
      await db.query("INSERT INTO order_plans VALUES ('p','o',$1,CURRENT_DATE,'plan',10000,10000)", [kind]);
      assert.deepEqual(await visible(), ["plan"], "unpaid plan is visible");
      await db.query("INSERT INTO order_cash_entries VALUES ('p','o','ACTIVE',$1,4000,90000)", [direction]);
      assert.deepEqual(await visible(), ["plan"], "partial payment stays visible despite a larger base currency amount");
      await db.query("INSERT INTO order_cash_entries VALUES ('p','o','ACTIVE',$1,6000,1000)", [direction]);
      assert.deepEqual(await visible(), [], "multiple entries settle the plan");
      await db.query("UPDATE order_cash_entries SET status='VOID' WHERE plan_amount_minor=6000");
      assert.deepEqual(await visible(), ["plan"], "voiding a payment restores the reminder");
      await db.query("INSERT INTO order_cash_entries VALUES ('p','o','ACTIVE',$1,20000,1)", [direction === "RECEIPT" ? "PAYMENT" : "RECEIPT"]);
      await db.query("INSERT INTO order_cash_entries VALUES (NULL,'o','ACTIVE',$1,20000,1),('other','o','ACTIVE',$1,20000,1),('p','other','ACTIVE',$1,20000,1)", [direction]);
      assert.deepEqual(await visible(), ["plan"], "wrong direction, unallocated and unrelated entries do not settle this plan");
      await db.query("UPDATE order_cash_entries SET status='ACTIVE',plan_amount_minor=7000 WHERE status='VOID'");
      assert.deepEqual(await visible(), [], "overpaid plan is complete even with a lower base currency amount");
    }
    await db.query("TRUNCATE order_cash_entries");
    await db.query("UPDATE order_plans SET due_date=CURRENT_DATE+8");
    assert.deepEqual(await visible(), [], "future plans outside the reminder window stay hidden");
    await db.query("UPDATE order_plans SET due_date=NULL");
    assert.deepEqual(await visible(), [], "undated plans stay hidden");
    await db.query("UPDATE order_plans SET due_date=CURRENT_DATE-1");
    await db.query("UPDATE orders SET status='CLOSED'");
    assert.deepEqual(await visible(), [], "closed orders stay hidden");
    await db.query("UPDATE orders SET status='PAUSED'");
    assert.deepEqual(await visible(), ["plan"], "overdue unpaid paused orders remain visible");
    await db.query("TRUNCATE order_plans, order_cash_entries");
    await db.query("INSERT INTO order_plans VALUES ('p','o','RECEIVABLE',CURRENT_DATE,'fx plan',78400,10000)");
    await db.query("INSERT INTO order_cash_entries VALUES ('p','o','ACTIVE','RECEIPT',78400,9800)");
    const outstandingStart = source.indexOf("WITH plans AS MATERIALIZED");
    const outstandingEnd = source.indexOf("FROM remaining", outstandingStart) + "FROM remaining".length;
    const outstandingQuery = source.slice(outstandingStart, outstandingEnd)
      .replaceAll("${orderScope.sql}", "o.id='o'");
    const outstanding = await db.query(outstandingQuery);
    assert.equal(Number(outstanding.rows[0].receivable), 0, "a plan paid in full in its own currency has no outstanding balance");
    await db.query("TRUNCATE order_plans, order_cash_entries");
    await db.query("INSERT INTO order_plans VALUES ('p','o','RECEIVABLE',CURRENT_DATE,'plan',10000,10000)");
    await db.query(`
      CREATE TEMP TABLE order_steps (order_id text,name text,due_date date,status text);
      CREATE TEMP TABLE order_progress (order_id text,next_action text,title text,follow_up_date date,follow_up_done int);
      CREATE TEMP TABLE order_materials (id text,order_id text,applicant_id text,name text,expected_date date);
      CREATE TEMP TABLE material_files (material_id text,status text);
      CREATE TEMP TABLE order_tasks (order_id text,title text,due_date date,status text);
      INSERT INTO order_steps VALUES ('o','step',CURRENT_DATE,'PENDING');
      INSERT INTO order_progress VALUES ('o','follow','follow',CURRENT_DATE,0);
      INSERT INTO order_materials VALUES ('m1','o','person','personal',CURRENT_DATE),('m2','o',NULL,'common',CURRENT_DATE);
      INSERT INTO order_tasks VALUES ('o','task',CURRENT_DATE,'OPEN');
    `);
    const fullStart = source.indexOf("SELECT * FROM (");
    const fullEnd = source.indexOf("LIMIT 30", fullStart) + "LIMIT 30".length;
    const fullQuery = source.slice(fullStart, fullEnd)
      .replaceAll("${orderScope.sql}", "o.id='o'")
      .replaceAll("${sevenDays}", "CURRENT_DATE + 7")
      .replace(/\$\{canRead(?:Finance|Orders|Materials|Tasks)\}/g, "TRUE");
    const targets = Object.fromEntries((await db.query(fullQuery)).rows.map(row => [row.title, row.target_tab]));
    assert.deepEqual(targets, { plan: "finance", step: "workflow", follow: "workflow", personal: "people", common: "common", task: "workflow" });
  } finally {
    await db.end();
  }
});

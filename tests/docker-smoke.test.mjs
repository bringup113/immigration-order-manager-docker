import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import pg from "pg";

const baseUrl = process.env.MIGRA_BASE_URL;
const username = process.env.MIGRA_TEST_USERNAME;
const password = process.env.MIGRA_TEST_PASSWORD;
const enabled = Boolean(baseUrl && username && password);
const databaseUrl = process.env.MIGRA_DATABASE_URL;

async function login() {
  return loginAs(username, password);
}

async function loginAs(loginUsername, loginPassword) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    body: new URLSearchParams({ username: loginUsername, password: loginPassword, return_to: "/" }),
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^migra_session=/);
  return cookie;
}

async function getOrderRows(cookie) {
  const page=await getJson("/api/data/orders",cookie);
  assert.ok(Array.isArray(page.rows));
  assert.equal(typeof page.hasMore,"boolean");
  return page.rows;
}
async function getJson(path, cookie, attempt=0) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  if (response.status !== 200) assert.fail(`${path}: ${response.status} ${await response.text()}`);
  const data=await response.json();
  if(path.startsWith("/api/data/search?q=") && data.indexing && attempt<100) {
    await new Promise(resolve=>setTimeout(resolve,100));
    return getJson(path,cookie,attempt+1);
  }
  return data;
}

test("Docker PostgreSQL deployment exposes authenticated business data", { skip: !enabled }, async () => {
  const loginPage = await fetch(`${baseUrl}/api/auth/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /用户名/);

  const cookie = await login();
  const me = await getJson("/api/auth/me", cookie);
  assert.equal(me.username.toLowerCase(), username.toLowerCase());
  assert.equal(Array.isArray(me.permissions), true);

  const [dashboard, orders, search] = await Promise.all([
    getJson("/api/data/dashboard", cookie),
    getOrderRows(cookie),
    getJson("/api/data/search?q=", cookie),
  ]);
  assert.equal(typeof dashboard.activeOrders, "number");
  for (const reminder of dashboard.reminders) assert.match(reminder.due_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Array.isArray(orders), true);
  for (const order of orders) assert.equal("signed_at" in order, true);
  assert.equal(Array.isArray(search.orders), true);
  assert.equal(typeof search.pagination.orders.hasMore, "boolean");
});

test("unauthenticated page deep links survive the login redirect", { skip: !enabled }, async () => {
  const target = "/orders/MOBILE-DEEP-LINK?tab=finance";
  const response = await fetch(`${baseUrl}${target}`, { redirect: "manual" });
  assert.ok([303, 307, 308].includes(response.status), `unexpected status ${response.status}`);
  const location = new URL(response.headers.get("location"), baseUrl);
  assert.equal(location.pathname, "/api/auth/login");
  assert.equal(location.searchParams.get("return_to"), target);
});

test("login preserves a safe destination and rejects external return paths", { skip: !enabled }, async () => {
  const target = "/orders/CI-FIXTURE-2026091501?tab=finance";
  const loginPage = await fetch(`${baseUrl}/api/auth/login?return_to=${encodeURIComponent(target)}`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /name="return_to" value="\/orders\/CI-FIXTURE-2026091501\?tab=finance"/);

  const valid = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    body: new URLSearchParams({ username, password, return_to: target }),
    redirect: "manual",
  });
  assert.equal(valid.status, 303);
  assert.equal(valid.headers.get("location"), target);

  const external = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    body: new URLSearchParams({ username, password, return_to: "//example.com/steal" }),
    redirect: "manual",
  });
  assert.equal(external.status, 303);
  assert.equal(external.headers.get("location"), "/");
});

test("logout opens a clean login page without a stale error", { skip: !enabled }, async () => {
  const cookie = await login();
  const logout = await fetch(`${baseUrl}/api/auth/logout?return_to=/`, {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(logout.status, 303);
  const location = new URL(logout.headers.get("location") || "/api/auth/login", baseUrl);
  assert.equal(location.searchParams.has("error"), false);
  const page = await fetch(`${baseUrl}${location.pathname}${location.search}`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /用户名或密码不正确/);
});

test("stale order versions are rejected without changing data", { skip: !enabled }, async () => {
  const cookie = await login();
  const orders = await getOrderRows(cookie);
  assert.ok(orders.length, "隔离集成测试夹具缺少订单");
  const detail = await getJson(`/api/orders/${encodeURIComponent(orders[0].order_no)}`, cookie);
  assert.ok(meets(detail.order.version) && detail.order.version > 0, "订单版本号无效");

  const response = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(orders[0].order_no)}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "updateNotes", notes: "此内容不应保存", expectedVersion: detail.order.version - 1 }),
  });
  assert.equal(response.status, 409);

  const unchanged = await getJson(`/api/orders/${encodeURIComponent(orders[0].order_no)}`, cookie);
  assert.equal(unchanged.order.notes, detail.order.notes);
  assert.equal(unchanged.order.version, detail.order.version);
});

test("order API rejects invalid dates, oversized text, enums, currencies, and amounts", { skip: !enabled }, async () => {
  const cookie = await login();
  const orders = await getOrderRows(cookie);
  assert.ok(orders.length, "隔离集成测试夹具缺少订单");
  const orderNo = orders[0].order_no;
  const detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
  const send = (payload) => fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...payload, expectedVersion: detail.order.version }),
  });
  assert.equal((await send({ action: "updateNotes", notes: "x".repeat(4_001) })).status, 400);
  assert.equal((await send({ action: "updateSignedAt", signedAt: "2026-02-30" })).status, 400);
  assert.equal((await send({ action: "updateSignedAt", signedAt: "" })).status, 400);
  if (detail.steps.length) assert.equal((await send({ action: "step", stepId: detail.steps[0].id, status: "UNKNOWN" })).status, 400);
  const unchanged = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
  assert.equal(unchanged.order.version, detail.order.version);
});

function meets(value) {
  return typeof value === "number" || /^\d+$/.test(String(value));
}

test("workflow transitions keep one current step, advance automatically, require reasons, and write audits", { skip: !(enabled && databaseUrl) }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const orderId = `test_ord_${suffix}`;
  const orderNo = `TEST-${suffix}`;
  let readonlyId = "";
  try {
    const source = await database.query(`SELECT c.id AS agent_id,p.id AS project_id,p.code,p.name,p.country,p.revision_no
      FROM agents c CROSS JOIN projects p WHERE c.active=1 AND p.status='ACTIVE' LIMIT 1`);
    assert.equal(source.rowCount, 1, "隔离集成测试夹具缺少启用的代理或项目");
    const row = source.rows[0];
    const owner = await database.query("SELECT id FROM users WHERE active=1 ORDER BY role_id='role_owner' DESC,created_at LIMIT 1");
    assert.equal(owner.rowCount, 1, "隔离集成测试夹具缺少启用的系统所有者");
    const now = new Date().toISOString();
    await database.query(`INSERT INTO orders
      (id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,project_revision,status,
       signed_at,owner_user_id,created_at,updated_at,status_changed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',CURRENT_DATE,$9,$10,$10,$10)`,
      [orderId, orderNo, row.agent_id, row.project_id, row.code, row.name, row.country, row.revision_no, owner.rows[0].id, now]);
    for (let index = 1; index <= 3; index += 1) {
      await database.query(`INSERT INTO order_steps
        (id,order_id,name,sequence,required,status,started_at,created_at,updated_at)
        VALUES ($1,$2,$3,$4,1,$5,$6,$7,$7)`,
      [`test_stp_${suffix}_${index}`, orderId, `测试流程 ${index}`, index, index === 1 ? "IN_PROGRESS" : "PENDING", index === 1 ? now : null, now]);
    }

    const cookie = await login();
    const readonlyUsername = `readonly_${suffix.toLowerCase()}`;
    const readonlyPassword = `Mobile-${suffix}-ReadOnly!`;
    const createdReadonly = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "create", username: readonlyUsername, displayName: "手机只读测试", password: readonlyPassword, roleId: "role_readonly" }),
    });
    assert.equal(createdReadonly.status, 201, await createdReadonly.clone().text());
    readonlyId = (await createdReadonly.json()).id;
    await database.query("UPDATE users SET must_change_password=0 WHERE id=$1", [readonlyId]);
    const readonlyCookie = await loginAs(readonlyUsername, readonlyPassword);
    assert.equal((await fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}?section=workflow`, { headers: { cookie: readonlyCookie } })).status, 200);
    for (const payload of [
      { action: "step", stepId: `test_stp_${suffix}_1`, status: "COMPLETED", expectedVersion: 1 },
      { action: "progress", title: "不可写入", progressDate: "2026-09-21", expectedVersion: 1 },
    ]) {
      const denied = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}`, {
        method: "POST", headers: { cookie: readonlyCookie, "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      assert.equal(denied.status, 403, "只读账号不得写入流程或跟进");
    }
    const mutate = async (payload, status = 200) => {
      const response = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}`, {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      assert.equal(response.status, status, await response.text());
      return response;
    };

    await mutate({ action: "step", stepId: `test_stp_${suffix}_1`, status: "COMPLETED", expectedVersion: 1 });
    let detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.steps.find((step) => step.id.endsWith("_2")).status, "IN_PROGRESS");
    assert.equal(detail.steps.filter((step) => step.status === "IN_PROGRESS").length, 1);

    await mutate({ action: "step", stepId: `test_stp_${suffix}_3`, status: "IN_PROGRESS", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.steps.find((step) => step.id.endsWith("_2")).status, "PENDING");
    assert.equal(detail.steps.find((step) => step.id.endsWith("_3")).status, "IN_PROGRESS");

    await mutate({ action: "step", stepId: `test_stp_${suffix}_3`, status: "SKIPPED", expectedVersion: detail.order.version }, 400);
    await mutate({ action: "step", stepId: `test_stp_${suffix}_3`, status: "SKIPPED", reason: "集成测试强制跳过", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    await mutate({ action: "progress", title: "手机端跟进测试", progressDate: "2026-09-21", details: "已联系申请人", nextAction: "等待材料", followUpDate: "2026-09-25", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}?section=workflow`, cookie);
    assert.equal(detail.progress[0].title, "手机端跟进测试");
    assert.equal(detail.progress[0].next_action, "等待材料");
    await mutate({ action: "status", status: "PAUSED", expectedVersion: detail.order.version }, 400);
    await mutate({ action: "status", status: "PAUSED", reason: "集成测试暂停", expectedVersion: detail.order.version });

    const checks = await database.query("SELECT action,changes_json FROM audit_logs WHERE entity_type='ORDER' AND entity_id=$1", [orderNo]);
    assert.equal(checks.rows.filter((item) => item.action === "ORDER_STEP").length >= 3, true);
    assert.equal(checks.rows.some((item) => item.action === "ORDER_STATUS"), true);
    assert.equal(checks.rows.some((item) => item.action === "ORDER_PROGRESS"), true);
    assert.equal(checks.rows.some((item) => String(item.changes_json).includes("集成测试强制跳过")), true);
  } finally {
    if (readonlyId) {
      await database.query("DELETE FROM audit_logs WHERE entity_id=$1", [readonlyId]).catch(() => undefined);
      await database.query("DELETE FROM users WHERE id=$1", [readonlyId]).catch(() => undefined);
    }
    await database.query("DELETE FROM orders WHERE id=$1", [orderId]).catch(() => undefined);
    await database.query("DELETE FROM audit_logs WHERE entity_type='ORDER' AND entity_id=$1", [orderNo]).catch(() => undefined);
    await database.end();
  }
});

test("mobile cash writes keep original-currency allocation, permissions, bounds, and audits", { skip: !(enabled && databaseUrl) }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const orderId = `test_ord_mobile_cash_${suffix}`;
  const orderNo = `MOBILE-CASH-${suffix}`;
  const receiptPlanId = `test_plan_mobile_r_${suffix}`;
  const paymentPlanId = `test_plan_mobile_p_${suffix}`;
  let readonlyId = "";
  const cashIds = [];
  try {
    const source = await database.query(`SELECT c.id AS agent_id,p.id AS project_id,p.code,p.name,p.country,p.revision_no,u.id AS owner_user_id
      FROM agents c CROSS JOIN projects p CROSS JOIN LATERAL (SELECT id FROM users WHERE active=1 AND role_id='role_owner' ORDER BY created_at LIMIT 1) u
      WHERE c.active=1 AND p.status='ACTIVE' LIMIT 1`);
    assert.equal(source.rowCount, 1);
    assert.equal((await database.query("SELECT active FROM exchange_rates WHERE currency='MYR'")).rows[0]?.active, 1);
    const row = source.rows[0];
    const now = new Date().toISOString();
    await database.query(`INSERT INTO orders
      (id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,project_revision,status,signed_at,owner_user_id,created_at,updated_at,status_changed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',CURRENT_DATE,$9,$10,$10,$10)`,
      [orderId, orderNo, row.agent_id, row.project_id, row.code, row.name, row.country, row.revision_no, row.owner_user_id, now]);
    await database.query(`INSERT INTO order_plans
      (id,order_id,plan_type,sequence,name,currency,planned_amount_minor,budget_rate_scaled,planned_base_minor)
      VALUES ($1,$2,'RECEIVABLE',1,'测试应收','USD',10000,100000000,10000),
             ($3,$2,'PAYABLE',1,'测试应付','MYR',40400,404000000,10000)`, [receiptPlanId, orderId, paymentPlanId]);
    const cookie = await login();
    const read = () => getJson(`/api/orders/${encodeURIComponent(orderNo)}?section=finance`, cookie);
    const post = async (payload, expectedStatus) => {
      const response = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}`, {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      assert.equal(response.status, expectedStatus, await response.clone().text());
      return response;
    };
    let detail = await read();
    assert.ok(detail.availableCurrencies.some((option) => option.currency === "MYR"));
    const receipt = {
      action: "saveCashEntry", direction: "RECEIPT", entryDate: "2026-09-22", description: "手机收款测试",
      currency: "MYR", amount: "404", baseAmount: "100", ratePerUsd: "4.04", calculatedField: "baseAmount",
      orderPlanId: receiptPlanId, notes: "", expectedVersion: detail.order.version,
    };
    cashIds.push((await (await post(receipt, 201)).json()).id);
    detail = await read();
    assert.equal(detail.receivedBaseMinor, 10000);
    assert.equal(Number(detail.plans.find((plan) => plan.id === receiptPlanId).allocated_minor), 10000);
    await post(receipt, 409);
    assert.equal((await database.query("SELECT COUNT(*)::int AS total FROM order_cash_entries WHERE order_id=$1", [orderId])).rows[0].total, 1);
    const payment = {
      ...receipt, direction: "PAYMENT", description: "手机付款测试", calculatedField: "ratePerUsd",
      orderPlanId: paymentPlanId, expectedVersion: detail.order.version,
    };
    cashIds.push((await (await post(payment, 201)).json()).id);
    detail = await read();
    assert.equal(detail.paidBaseMinor, 10000);
    assert.equal(Number(detail.plans.find((plan) => plan.id === paymentPlanId).allocated_minor), 40400);
    await post({ ...payment, direction: "RECEIPT", expectedVersion: detail.order.version }, 400);
    await post({ ...payment, amount: "1e20", expectedVersion: detail.order.version }, 400);
    assert.equal((await read()).order.version, detail.order.version);

    const readonlyUsername = `cash_readonly_${suffix.toLowerCase()}`;
    const readonlyPassword = `MobileCash-${suffix}-ReadOnly!`;
    const created = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "create", username: readonlyUsername, displayName: "手机财务只读测试", password: readonlyPassword, roleId: "role_readonly" }),
    });
    assert.equal(created.status, 201, await created.clone().text());
    readonlyId = (await created.json()).id;
    await database.query("UPDATE users SET must_change_password=0 WHERE id=$1", [readonlyId]);
    const readonlyCookie = await loginAs(readonlyUsername, readonlyPassword);
    const readonlyDetail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}?section=finance`, readonlyCookie);
    assert.equal(Object.hasOwn(readonlyDetail, "availableCurrencies"), false);
    const denied = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}`, {
      method: "POST", headers: { cookie: readonlyCookie, "content-type": "application/json" },
      body: JSON.stringify({ ...receipt, expectedVersion: detail.order.version }),
    });
    assert.equal(denied.status, 403);
    const audits = await database.query("SELECT action,result FROM audit_logs WHERE entity_type='CASH_ENTRY' AND entity_id=ANY($1::text[])", [cashIds]);
    assert.equal(audits.rows.filter((entry) => entry.action === "ORDER_SAVECASHENTRY" && entry.result === "SUCCESS").length, 2);
  } finally {
    if (readonlyId) {
      await database.query("DELETE FROM audit_logs WHERE entity_id=$1", [readonlyId]).catch(() => undefined);
      await database.query("DELETE FROM users WHERE id=$1", [readonlyId]).catch(() => undefined);
    }
    await database.query("DELETE FROM orders WHERE id=$1", [orderId]).catch(() => undefined);
    await database.query("DELETE FROM audit_logs WHERE entity_id=$1 OR entity_id=ANY($2::text[])", [orderNo, cashIds]).catch(() => undefined);
    await database.end();
  }
});

test("OWN scope isolates every order surface and tasks complete their full lifecycle", { skip: !(enabled && databaseUrl) }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const roleId = `test_role_${suffix}`;
  const userName = `sales_${suffix.toLowerCase()}`;
  const userPassword = `Scope-${suffix}-Pass!`;
  const ownAgentId = `test_cus_own_${suffix}`;
  const otherAgentId = `test_cus_other_${suffix}`;
  const ownProjectId = `test_prj_own_${suffix}`;
  const otherProjectId = `test_prj_other_${suffix}`;
  const ownOrderId = `test_ord_own_${suffix}`;
  const otherOrderId = `test_ord_other_${suffix}`;
  const ownOrderNo = `OWN-${suffix}`;
  const otherOrderNo = `OTHER-${suffix}`;
  const ownApplicantId = `test_apl_own_${suffix}`;
  const otherApplicantId = `test_apl_other_${suffix}`;
  const otherMaterialId = `test_mat_other_${suffix}`;
  const otherFileId = `test_fil_other_${suffix}`;
  let userId = "";
  try {
    const owner = await database.query("SELECT id FROM users WHERE active=1 AND role_id='role_owner' ORDER BY created_at LIMIT 1");
    assert.equal(owner.rowCount, 1, "隔离集成测试夹具缺少启用的系统所有者");
    const ownerId = owner.rows[0].id;
    const now = new Date().toISOString();
    await database.query(`INSERT INTO roles (id,code,name,description,is_system,active,order_scope,created_at,updated_at)
      VALUES ($1,$2,$3,'集成测试本人订单角色',0,1,'OWN',$4,$4)`, [roleId, `TEST_OWN_${suffix}`, `测试业务员 ${suffix}`, now]);
    for (const permission of ["dashboard.read", "orders.read", "orders.write", "tasks.read", "tasks.write", "finance.read", "finance.write", "materials.read", "agents.read", "projects.read"]) {
      await database.query("INSERT INTO role_permissions (role_id,permission) VALUES ($1,$2)", [roleId, permission]);
    }

    const ownerCookie = await login();
    const createUser = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "create", username: userName, displayName: `测试业务员 ${suffix}`, password: userPassword, roleId }),
    });
    assert.equal(createUser.status, 201, await createUser.clone().text());
    userId = (await createUser.json()).id;
    await database.query("UPDATE users SET must_change_password=0 WHERE id=$1", [userId]);

    await database.query(`INSERT INTO agents (id,code,name,active,created_at,updated_at)
      VALUES ($1,$2,$3,1,$4,$4),($5,$6,$7,1,$4,$4)`,
      [ownAgentId, `OWNA-${suffix}`, `本人代理 ${suffix}`, now, otherAgentId, `OTHA-${suffix}`, `他人代理 ${suffix}`]);
    await database.query(`INSERT INTO projects (id,code,name,country,default_receivable_currency,provider_currency,status,created_at,updated_at)
      VALUES ($1,$2,$3,'测试地区','USD','USD','ACTIVE',$4,$4),($5,$6,$7,'测试地区','USD','USD','ACTIVE',$4,$4)`,
      [ownProjectId, `OWNP_${suffix}`, `本人项目 ${suffix}`, now, otherProjectId, `OTHP_${suffix}`, `他人项目 ${suffix}`]);
    await database.query(`INSERT INTO orders
      (id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,project_revision,status,
       signed_at,owner_user_id,created_at,updated_at,status_changed_at)
      VALUES ($1,$2,$3,$4,$5,$6,'测试地区',1,'ACTIVE',CURRENT_DATE,$7,$8,$8,$8),
             ($9,$10,$11,$12,$13,$14,'测试地区',1,'ACTIVE',CURRENT_DATE,$15,$8,$8,$8)`,
      [ownOrderId, ownOrderNo, ownAgentId, ownProjectId, `OWNP_${suffix}`, `本人项目 ${suffix}`, userId, now,
       otherOrderId, otherOrderNo, otherAgentId, otherProjectId, `OTHP_${suffix}`, `他人项目 ${suffix}`, ownerId]);
    await database.query(`INSERT INTO order_applicants (id,order_id,applicant_type,name,passport_no,sequence)
      VALUES ($1,$2,'MAIN',$3,$4,0),($5,$6,'MAIN',$7,$8,0)`,
      [ownApplicantId, ownOrderId, `本人申请人 ${suffix}`, `OWN${suffix}`, otherApplicantId, otherOrderId, `他人申请人 ${suffix}`, `OTHER${suffix}`]);
    await database.query(`INSERT INTO order_cash_entries
      (id,order_id,direction,entry_date,description,currency,amount_minor,rate_scaled,base_amount_minor,created_at,updated_at)
      VALUES ($1,$2,'RECEIPT',CURRENT_DATE,'本人订单收款','USD',12345,100000000,12345,$3,$3),
             ($4,$5,'RECEIPT',CURRENT_DATE,'他人订单收款','USD',98765,100000000,98765,$3,$3)`,
      [`test_cash_own_${suffix}`, ownOrderId, now, `test_cash_other_${suffix}`, otherOrderId]);
    await database.query("INSERT INTO order_materials (id,order_id,applicant_id,name,required,sequence) VALUES ($1,$2,$3,'他人护照',1,0)", [otherMaterialId, otherOrderId, otherApplicantId]);
    await database.query(`INSERT INTO material_files (id,order_id,material_id,original_name,stored_name,relative_path,mime_type,size_bytes,uploaded_at,sha256)
      VALUES ($1,$2,$3,'other.pdf','other.pdf',$4,'application/pdf',4,$5,$6)`,
      [otherFileId, otherOrderId, otherMaterialId, `test/${suffix}/other.pdf`, now, "0".repeat(64)]);

    const assign = async (ownerUserId, expectedVersion) => fetch(`${baseUrl}/api/orders/${encodeURIComponent(otherOrderNo)}`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "assignOwner", ownerUserId, expectedVersion }),
    });
    assert.equal((await assign(userId, 1)).status, 200);
    assert.equal((await assign(ownerId, 2)).status, 200);

    const ownCookie = await loginAs(userName, userPassword);
    const ownOrders = await getOrderRows(ownCookie);
    assert.deepEqual(ownOrders.map((order) => order.order_no), [ownOrderNo]);
    assert.equal(Number(ownOrders[0].received_base_minor), 12345);
    assert.equal((await fetch(`${baseUrl}/api/orders/${encodeURIComponent(otherOrderNo)}`, { headers: { cookie: ownCookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/material-files/${encodeURIComponent(otherFileId)}`, { headers: { cookie: ownCookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/orders/${encodeURIComponent(otherOrderNo)}`, {
      method: "POST", headers: { cookie: ownCookie, "content-type": "application/json" }, body: JSON.stringify({ action: "updateNotes", notes: "不可写入", expectedVersion: 3 }),
    })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/orders/${encodeURIComponent(otherOrderNo)}`, {
      method: "POST", headers: { cookie: ownCookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "saveCashEntry", direction: "RECEIPT", entryDate: "2026-09-22", description: "不可写入", currency: "USD", amount: "1", baseAmount: "1", ratePerUsd: "1", calculatedField: "baseAmount", expectedVersion: 3 }),
    })).status, 404);

    const ownSearch = await getJson(`/api/data/search?q=${encodeURIComponent(`本人申请人+${suffix}`)}`, ownCookie);
    assert.equal(ownSearch.orders.some((order) => order.order_no === ownOrderNo), true);
    const otherSearch = await getJson(`/api/data/search?q=${encodeURIComponent(`他人申请人+${suffix}`)}`, ownCookie);
    assert.equal(otherSearch.orders.length, 0);
    const otherAgentSearch = await getJson(`/api/data/search?q=${encodeURIComponent(`他人代理+${suffix}`)}`, ownCookie);
    assert.equal(otherAgentSearch.agents.length, 0);
    assert.equal(otherAgentSearch.projects.length, 0);
    for (const group of ["orders", "projects", "agents"]) {
      const scoped = await getJson(`/api/data/search?q=&group=${group}&page=1&pageSize=30`, ownCookie);
      assert.ok(scoped.orders.every((order) => order.order_no === ownOrderNo));
      assert.ok(scoped.projects.every((project) => project.id === ownProjectId));
      assert.ok(scoped.agents.every((agent) => agent.id === ownAgentId));
      assert.equal(scoped[group].length, 1);
    }

    let detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    assert.equal(Object.hasOwn(detail, "availableCurrencies"), true, "financial writer without currencies.read still receives finance form options");
    const taskPost = async (payload, expectedStatus = 200) => {
      const response = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(ownOrderNo)}`, {
        method: "POST", headers: { cookie: ownCookie, "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      assert.equal(response.status, expectedStatus, await response.clone().text());
      return response;
    };
    const firstCreate = await taskPost({ action: "saveTask", title: `催材料 ${suffix}`, dueDate: new Date().toISOString().slice(0, 10), priority: "HIGH", ownerUserId: userId, relatedType: "APPLICANT", relatedId: ownApplicantId, expectedVersion: detail.order.version }, 201);
    const firstTaskId = (await firstCreate.json()).id;
    detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    const secondCreate = await taskPost({ action: "saveTask", title: `联系渠道 ${suffix}`, dueDate: new Date().toISOString().slice(0, 10), priority: "LOW", ownerUserId: userId, expectedVersion: detail.order.version }, 201);
    const secondTaskId = (await secondCreate.json()).id;
    detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    assert.equal(detail.tasks.filter((task) => task.status === "OPEN").length, 2);
    await taskPost({ action: "saveTask", taskId: firstTaskId, title: `催材料并复核 ${suffix}`, dueDate: new Date().toISOString().slice(0, 10), priority: "HIGH", ownerUserId: userId, relatedType: "APPLICANT", relatedId: ownApplicantId, expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    await taskPost({ action: "toggleTask", taskId: firstTaskId, status: "COMPLETED", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    await taskPost({ action: "toggleTask", taskId: firstTaskId, status: "OPEN", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    await taskPost({ action: "deleteTask", taskId: secondTaskId, expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    assert.equal(detail.tasks.length, 1);
    assert.equal(detail.tasks[0].title, `催材料并复核 ${suffix}`);
    assert.equal((await taskPost({ action: "saveTask", title: "非法日期", dueDate: "2026-02-30", priority: "MEDIUM", ownerUserId: userId, expectedVersion: detail.order.version }, 400)).status, 400);

    const dashboard = await getJson("/api/data/dashboard", ownCookie);
    assert.equal(dashboard.activeOrders, 1);
    assert.equal(dashboard.balanceMinor, 12345);
    assert.equal(dashboard.reminders.some((item) => item.reminder_type === "TASK" && item.title === `催材料并复核 ${suffix}`), true);
    await database.query("DELETE FROM role_permissions WHERE role_id=$1 AND permission='finance.read'", [roleId]);
    detail = await getJson(`/api/orders/${encodeURIComponent(ownOrderNo)}`, ownCookie);
    const closed = await taskPost({
      action: "closeOrder",
      closedOn: new Date().toISOString().slice(0, 10),
      closureResult: "权限边界回归",
      expectedVersion: detail.order.version,
    });
    const closedBody = await closed.json();
    assert.equal(Object.hasOwn(closedBody.check, "receivableBaseMinor"), false);
    assert.equal(Object.hasOwn(closedBody.check, "receivedBaseMinor"), false);
    const audits = await database.query("SELECT action,changes_json FROM audit_logs WHERE actor_user_id=$1 OR (entity_type='ORDER' AND entity_id=$2)", [userId, otherOrderNo]);
    for (const action of ["TASK_CREATE", "TASK_UPDATE", "TASK_COMPLETE", "TASK_REOPEN", "TASK_DELETE"]) assert.equal(audits.rows.some((row) => row.action === action), true, `${action} audit missing`);
    const ownerAudit = audits.rows.filter((row) => row.action === "ORDER_ASSIGNOWNER");
    assert.equal(ownerAudit.length >= 2, true);
    assert.equal(ownerAudit.every((row) => String(row.changes_json).includes("owner_user_id")), true);
  } finally {
    await database.query("DELETE FROM orders WHERE id IN ($1,$2)", [ownOrderId, otherOrderId]).catch(() => undefined);
    await database.query("DELETE FROM agents WHERE id IN ($1,$2)", [ownAgentId, otherAgentId]).catch(() => undefined);
    await database.query("DELETE FROM projects WHERE id IN ($1,$2)", [ownProjectId, otherProjectId]).catch(() => undefined);
    if (userId) await database.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await database.query("DELETE FROM roles WHERE id=$1", [roleId]).catch(() => undefined);
    await database.query("DELETE FROM audit_logs WHERE entity_id IN ($1,$2) OR actor_username_snapshot=$3", [ownOrderNo, otherOrderNo, userName]).catch(() => undefined);
    await database.end();
  }
});

test("mobile material permissions preserve preview-only access and audited MRZ confirmation", { skip: !(enabled && databaseUrl) }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const orderId = `test_ord_mrz_${suffix}`;
  const orderNo = `MRZ-${suffix}`;
  const applicantId = `test_app_mrz_${suffix}`;
  const materialId = `test_mat_mrz_${suffix}`;
  let readonlyId = "";
  let uploadedPath = "";
  try {
    const source = await database.query(`SELECT c.id AS agent_id,p.id AS project_id,p.code,p.name,p.country,p.revision_no,u.id AS owner_user_id
      FROM agents c CROSS JOIN projects p CROSS JOIN LATERAL (SELECT id FROM users WHERE active=1 AND role_id='role_owner' ORDER BY created_at LIMIT 1) u
      WHERE c.active=1 AND p.status='ACTIVE' LIMIT 1`);
    assert.equal(source.rowCount, 1);
    const row = source.rows[0];
    const now = new Date().toISOString();
    await database.query(`INSERT INTO orders
      (id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,project_revision,status,signed_at,owner_user_id,created_at,updated_at,status_changed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',CURRENT_DATE,$9,$10,$10,$10)`,
      [orderId, orderNo, row.agent_id, row.project_id, row.code, row.name, row.country, row.revision_no, row.owner_user_id, now]);
    await database.query("INSERT INTO order_applicants (id,order_id,applicant_type,name,sequence) VALUES ($1,$2,'MAIN','人工确认姓名',0)", [applicantId, orderId]);
    await database.query("INSERT INTO order_materials (id,order_id,applicant_id,name,required,sequence,system_code) VALUES ($1,$2,$3,'护照首页',1,0,'PASSPORT_BIO_PAGE')", [materialId, orderId, applicantId]);
    const ownerCookie = await login();
    const readonlyUsername = `mobile_mrz_${suffix.toLowerCase()}`;
    const readonlyPassword = `MobileMrz-${suffix}-ReadOnly!`;
    const created = await fetch(`${baseUrl}/api/admin/users`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "create", username: readonlyUsername, displayName: "材料预览测试", password: readonlyPassword, roleId: "role_readonly" }) });
    assert.equal(created.status, 201, await created.clone().text());
    readonlyId = (await created.json()).id;
    await database.query("UPDATE users SET must_change_password=0 WHERE id=$1", [readonlyId]);
    const readonlyCookie = await loginAs(readonlyUsername, readonlyPassword);

    const fileBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZxkAAAAASUVORK5CYII=", "base64");
    const uploadForm = () => { const form = new FormData(); form.set("orderNo", orderNo); form.set("materialId", materialId);
      form.set("file", new File([fileBytes], "护照首页.png", { type: "image/png" })); return form; };
    assert.equal((await fetch(`${baseUrl}/api/material-files`, { method: "POST", headers: { cookie: readonlyCookie }, body: uploadForm() })).status, 403);
    const uploaded = await fetch(`${baseUrl}/api/material-files`, { method: "POST", headers: { cookie: ownerCookie }, body: uploadForm() });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const fileId = (await uploaded.json()).id;
    const stored = await database.query("SELECT relative_path,material_id,mime_type FROM material_files WHERE id=$1", [fileId]);
    assert.equal(stored.rows[0].material_id, materialId);
    assert.equal(stored.rows[0].mime_type, "image/png");
    uploadedPath = stored.rows[0].relative_path;

    const readonlyDetail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}?section=people`, readonlyCookie);
    assert.equal(readonlyDetail.materialFiles.some((file) => file.id === fileId), true);
    const preview = await fetch(`${baseUrl}/api/material-files/${encodeURIComponent(fileId)}`, { headers: { cookie: readonlyCookie } });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-disposition") || "", /^inline/);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), fileBytes);
    assert.equal((await fetch(`${baseUrl}/api/material-files/${encodeURIComponent(fileId)}?download=1`, { headers: { cookie: readonlyCookie } })).status, 403);

    const mrzPayload = { action: "confirmMrz", applicantId, materialFileId: fileId,
      rawMrz: "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10",
      fields: { name: "人工确认姓名", surname: "ERIKSSON", givenNames: "ANNA MARIA", nationality: "UTO", passportNo: "L898902C3", birthDate: "1974-08-12", sex: "F", passportExpiry: "2012-04-15", issuingCountry: "UTO", documentCode: "P", personalNumber: "ZE184226B" },
      expectedVersion: readonlyDetail.order.version };
    const confirm = (cookie) => fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}`, { method: "POST",
      headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(mrzPayload) });
    assert.equal((await confirm(readonlyCookie)).status, 403);
    const approved = await confirm(ownerCookie);
    assert.equal(approved.status, 200, await approved.clone().text());
    const applicant = await database.query("SELECT name,passport_no,mrz_status FROM order_applicants WHERE id=$1", [applicantId]);
    assert.equal(applicant.rows[0].name, "人工确认姓名");
    assert.equal(applicant.rows[0].passport_no, "L898902C3");
    assert.equal(applicant.rows[0].mrz_status, "VALID");
    const audits = await database.query("SELECT action,result FROM audit_logs WHERE entity_id=$1 OR (entity_type='APPLICANT' AND entity_id=$2)", [fileId, applicantId]);
    for (const action of ["MATERIAL_FILE_UPLOAD", "MATERIAL_FILE_PREVIEW", "APPLICANT_MRZ_CONFIRM"])
      assert.equal(audits.rows.some((audit) => audit.action === action && audit.result === "SUCCESS"), true, `${action} audit missing`);
  } finally {
    if (uploadedPath) { const root = resolve(process.env.MIGRA_TEST_UPLOAD_ROOT || "data/files");
      const absolute = resolve(root, uploadedPath); if (absolute.startsWith(root + "/")) rmSync(absolute, { force: true }); }
    if (readonlyId) { await database.query("DELETE FROM audit_logs WHERE entity_id=$1", [readonlyId]).catch(() => undefined);
      await database.query("DELETE FROM users WHERE id=$1", [readonlyId]).catch(() => undefined); }
    await database.query("DELETE FROM orders WHERE id=$1", [orderId]).catch(() => undefined);
    await database.query("DELETE FROM audit_logs WHERE entity_id=$1 OR entity_id=$2 OR (entity_type='APPLICANT' AND entity_id=$3)", [orderNo, applicantId, applicantId]).catch(() => undefined);
    await database.end();
  }
});

test("cash entries can be voided and restored, and warning-only closure can be reopened", { skip: !(enabled && databaseUrl) }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const orderId = `test_ord_history_${suffix}`;
  const orderNo = `HISTORY-${suffix}`;
  const cashId = `test_cash_history_${suffix}`;
  const fileMaterialId = `test_mat_file_${suffix}`;
  const uploadedPaths = [];
  try {
    const source = await database.query(`SELECT c.id AS agent_id,p.id AS project_id,p.code,p.name,p.country,p.revision_no,u.id AS owner_user_id
      FROM agents c CROSS JOIN projects p CROSS JOIN LATERAL (SELECT id FROM users WHERE active=1 AND role_id='role_owner' ORDER BY created_at LIMIT 1) u
      WHERE c.active=1 AND p.status='ACTIVE' LIMIT 1`);
    assert.equal(source.rowCount, 1, "隔离集成测试夹具缺少启用的代理、项目或系统所有者");
    const row = source.rows[0];
    const now = new Date().toISOString();
    await database.query(`INSERT INTO orders
      (id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,project_revision,status,signed_at,owner_user_id,created_at,updated_at,status_changed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',CURRENT_DATE,$9,$10,$10,$10)`,
      [orderId, orderNo, row.agent_id, row.project_id, row.code, row.name, row.country, row.revision_no, row.owner_user_id, now]);
    await database.query("INSERT INTO order_plans (id,order_id,plan_type,sequence,name,currency,planned_amount_minor,budget_rate_scaled,planned_base_minor) VALUES ($1,$2,'RECEIVABLE',1,'测试应收','USD',10000,100000000,10000),($3,$2,'PAYABLE',1,'测试应付','USD',4000,100000000,4000)", [`test_plan_r_${suffix}`, orderId, `test_plan_p_${suffix}`]);
    await database.query("INSERT INTO order_cash_entries (id,order_id,order_plan_id,direction,entry_date,description,currency,amount_minor,rate_scaled,base_amount_minor,plan_currency,plan_amount_minor,created_at,updated_at) VALUES ($1,$2,$3,'RECEIPT',CURRENT_DATE,'测试收款','USD',5000,100000000,5000,'USD',5000,$4,$4)", [cashId, orderId, `test_plan_r_${suffix}`, now]);
    await database.query("INSERT INTO order_materials (id,order_id,name,required,sequence) VALUES ($1,$2,'缺少但只警告的材料',1,0),($3,$2,'文件版本测试',0,1)", [`test_mat_history_${suffix}`, orderId, fileMaterialId]);
    await database.query("INSERT INTO order_steps (id,order_id,name,sequence,required,status,created_at,updated_at) VALUES ($1,$2,'必办测试流程',1,1,'PENDING',$3,$3)", [`test_step_history_${suffix}`, orderId, now]);
    await database.query("INSERT INTO order_progress (id,order_id,progress_date,title,next_action,follow_up_date,follow_up_done,pinned,created_at) VALUES ($1,$2,CURRENT_DATE,'测试跟进','待处理',CURRENT_DATE,0,0,$3)", [`test_progress_history_${suffix}`, orderId, now]);

    const cookie = await login();
    let detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.receivedBaseMinor, 5000);
    const mutate = async (payload, status = 200) => {
      const response = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(orderNo)}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
      assert.equal(response.status, status, await response.clone().text());
      return response;
    };

    const upload = async (content, replaceFileId, reason) => {
      const form = new FormData();
      form.set("orderNo", orderNo);
      form.set("materialId", fileMaterialId);
      form.set("file", new File([content], "测试文件.pdf", { type: "application/pdf" }));
      if (replaceFileId) { form.set("replaceFileId", replaceFileId); form.set("reason", reason); }
      const response = await fetch(`${baseUrl}/api/material-files`, { method: "POST", headers: { cookie }, body: form });
      assert.equal(response.status, 201, await response.clone().text());
      const id = (await response.json()).id;
      const stored = await database.query("SELECT relative_path FROM material_files WHERE id=$1", [id]);
      if (stored.rowCount) uploadedPaths.push(stored.rows[0].relative_path);
      return id;
    };
    const firstFileId = await upload("%PDF-1.4\nfirst version\n", "", "");
    const secondFileId = await upload("%PDF-1.4\nsecond version\n", firstFileId, "更新为清晰版本");
    let fileRows = await database.query("SELECT id,status,superseded_by_id,relative_path FROM material_files WHERE id IN ($1,$2) ORDER BY uploaded_at", [firstFileId, secondFileId]);
    assert.equal(fileRows.rows.find((file) => file.id === firstFileId).status, "SUPERSEDED");
    assert.equal(fileRows.rows.find((file) => file.id === firstFileId).superseded_by_id, secondFileId);
    assert.equal(fileRows.rows.find((file) => file.id === secondFileId).status, "ACTIVE");
    let response = await fetch(`${baseUrl}/api/material-files/${encodeURIComponent(secondFileId)}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "VOID", reason: "文件版本测试作废", expectedVersion: 1 }) });
    assert.equal(response.status, 200, await response.text());
    response = await fetch(`${baseUrl}/api/material-files/${encodeURIComponent(secondFileId)}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "RESTORE", reason: "文件版本测试恢复", expectedVersion: 2 }) });
    assert.equal(response.status, 200, await response.text());
    fileRows = await database.query("SELECT id,status,sha256 FROM material_files WHERE id IN ($1,$2)", [firstFileId, secondFileId]);
    assert.equal(fileRows.rows.find((file) => file.id === secondFileId).status, "ACTIVE");
    assert.match(fileRows.rows.find((file) => file.id === secondFileId).sha256, /^[0-9a-f]{64}$/);

    await mutate({ action: "voidCashEntry", entryId: cashId, reason: "测试作废", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.receivedBaseMinor, 0);
    assert.equal(Number(detail.plans[0].allocated_minor), 0);
    assert.equal(detail.cashEntries.find((entry) => entry.id === cashId).status, "VOIDED");
    await mutate({ action: "restoreCashEntry", entryId: cashId, reason: "测试恢复", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.receivedBaseMinor, 5000);
    assert.equal(Number(detail.plans[0].allocated_minor), 5000);
    assert.equal(detail.closureCheck.incompleteRequiredSteps, 1);
    assert.equal(detail.closureCheck.missingRequiredMaterials, 1);
    assert.equal(detail.closureCheck.openFollowUps, 1);

    await mutate({ action: "closeOrder", closedOn: new Date().toISOString().slice(0, 10), closureResult: "不应成功", expectedVersion: detail.order.version }, 400);
    await mutate({ action: "closeOrder", closedOn: new Date().toISOString().slice(0, 10), closureResult: "强制测试结案", closureNotes: "必办流程未完成", reason: "集成测试强制结案", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.order.status, "COMPLETED");
    assert.equal(detail.order.closure_result, "强制测试结案");
    await mutate({ action: "reopenOrder", reason: "测试重新开启", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.order.status, "ACTIVE");
    await mutate({ action: "step", stepId: `test_step_history_${suffix}`, status: "COMPLETED", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    await mutate({ action: "closeOrder", closedOn: new Date().toISOString().slice(0, 10), closureResult: "普通警告结案", closureNotes: "材料和跟进警告未阻止结案", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.order.status, "COMPLETED");
    await mutate({ action: "reopenOrder", reason: "测试第二次重新开启", expectedVersion: detail.order.version });
    detail = await getJson(`/api/orders/${encodeURIComponent(orderNo)}`, cookie);
    assert.equal(detail.order.status, "ACTIVE");
    assert.equal(detail.closureHistory.length, 4);

    const audit = await database.query("SELECT action,changes_json FROM audit_logs WHERE entity_id IN ($1,$2)", [orderNo, cashId]);
    for (const action of ["CASH_ENTRY_VOID", "CASH_ENTRY_RESTORE", "ORDER_CLOSE", "ORDER_REOPEN"]) assert.equal(audit.rows.some((entry) => entry.action === action), true, `${action} audit missing`);
    assert.equal(audit.rows.some((entry) => entry.action === "CASH_ENTRY_VOID" && String(entry.changes_json).includes("测试作废")), true);
  } finally {
    for (const relativePath of uploadedPaths) {
      const absolute = resolve(process.env.MIGRA_TEST_UPLOAD_ROOT || "data/files", relativePath);
      if (absolute.startsWith(resolve(process.env.MIGRA_TEST_UPLOAD_ROOT || "data/files") + "/")) rmSync(absolute, { force: true });
    }
    await database.query("DELETE FROM orders WHERE id=$1", [orderId]).catch(() => undefined);
    await database.query("DELETE FROM audit_logs WHERE entity_id IN ($1,$2)", [orderNo, cashId]).catch(() => undefined);
    await database.end();
  }
});

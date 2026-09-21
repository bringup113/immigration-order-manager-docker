import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import pg from "pg";

const baseUrl = process.env.MIGRA_BASE_URL;
const databaseUrl = process.env.MIGRA_DATABASE_URL;
const username = process.env.MIGRA_TEST_USERNAME;
const password = process.env.MIGRA_TEST_PASSWORD;
const uploadRoot = process.env.MIGRA_TEST_UPLOAD_ROOT;
const enabled = Boolean(baseUrl && databaseUrl && username && password);

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    body: new URLSearchParams({ username, password }),
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return cookie;
}

test(
  "current contract dates, staged applicants, and passive monitoring work together",
  { skip: !enabled, timeout: 60_000 },
  async () => {
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();

    const cookie = await login();
    const tag = randomUUID().replaceAll("-", "").slice(0, 12);
    const agentId = `agent_${tag}`;
    const projectId = `project_${tag}`;
    const stepTemplateId = `step_${tag}`;
    const planTemplateId = `plan_${tag}`;
    const orderIds = [];
    const rollbackDirectory = uploadRoot ? join(uploadRoot, `rollback-${tag}`) : "";
    const triggerName = `audit_fail_${tag}`;

    async function post(path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, 201, JSON.stringify(data));
      return data;
    }

    try {
      await db.query(
        "INSERT INTO agents(id,code,name,created_at,updated_at) VALUES ($1,$1,$1,now(),now())",
        [agentId],
      );
      await db.query(
        `INSERT INTO projects(id,code,name,country,created_at,updated_at)
         VALUES($1,$2,'日期回归','测试',now(),now())`,
        [projectId, `DT${tag.toUpperCase()}`],
      );
      await db.query(
        `INSERT INTO project_step_templates(id,project_id,name,sequence,due_days)
         VALUES($1,$2,'签约后7日',1,7)`,
        [stepTemplateId, projectId],
      );
      await db.query(
        `INSERT INTO project_plan_templates
          (id,project_id,plan_type,sequence,name,currency,amount_minor,due_days)
         VALUES($1,$2,'RECEIVABLE',1,'签约后30日','USD',10000,30)`,
        [planTemplateId, projectId],
      );

      for (const mode of ["template", "manual"]) {
        const order = await post("/api/data/orders", {
          agentId,
          projectId,
          status: "DRAFT",
          signedAt: "2024-02-28",
          applicants: [
            {
              name: "日期测试",
              passportNo: `P${tag}`,
              applicantType: "MAIN",
              nationality: "CHN",
              birthDate: "1990-01-01",
              passportExpiry: "2035-01-01",
            },
          ],
          steps: [
            {
              templateId: stepTemplateId,
              name: "流程",
              required: true,
              dueDate: "2099-01-01",
              dueDateMode: mode,
            },
          ],
          plans: [
            {
              templateId: planTemplateId,
              planType: "RECEIVABLE",
              name: "收款",
              currency: "USD",
              amount: "100",
              dueDate: "2099-01-01",
              dueDateMode: mode,
            },
          ],
        });
        orderIds.push(order.id);

        const dates = await db.query(
          `SELECT
             (SELECT due_date::text FROM order_steps WHERE order_id=$1 LIMIT 1) AS step,
             (SELECT due_date::text FROM order_plans WHERE order_id=$1 LIMIT 1) AS plan`,
          [order.id],
        );
        assert.equal(
          dates.rows[0].step,
          mode === "template" ? "2024-03-06" : "2099-01-01",
        );
        assert.equal(
          dates.rows[0].plan,
          mode === "template" ? "2024-03-29" : "2099-01-01",
        );
      }

      const minimalOrder = await post("/api/data/orders", {
        agentId,
        projectId,
        signedAt: "2026-09-15",
        applicants: [
          { name: "仅姓名主申请人", applicantType: "MAIN" },
          { name: "仅姓名附属申请人", applicantType: "DEPENDENT" },
        ],
      });
      orderIds.push(minimalOrder.id);

      const people = (
        await db.query(
          `SELECT id,passport_no FROM order_applicants
           WHERE order_id=$1 ORDER BY sequence`,
          [minimalOrder.id],
        )
      ).rows;
      assert.equal(people.length, 2);
      assert.ok(people.every((person) => person.passport_no === null));

      const change = (body) =>
        fetch(`${baseUrl}/api/orders/${minimalOrder.orderNo}`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        });

      const started = await change({ action: "status", status: "ACTIVE" });
      assert.equal(started.status, 200, await started.text());
      assert.equal(
        (await db.query("SELECT status FROM orders WHERE id=$1", [minimalOrder.id]))
          .rows[0].status,
        "ACTIVE",
      );
      assert.equal(
        (
          await db.query(
            `SELECT count(*)::int AS value FROM order_steps
             WHERE order_id=$1 AND status='IN_PROGRESS'`,
            [minimalOrder.id],
          )
        ).rows[0].value,
        1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS value FROM material_files WHERE order_id=$1",
            [minimalOrder.id],
          )
        ).rows[0].value,
        0,
      );
      assert.equal((await change({ action: "status", status: "PAUSED" })).status, 400);
      assert.equal((await change({ action: "status", status: "COMPLETED" })).status, 400);
      assert.equal((await change({ action: "addApplicant", name: "稍后补资料" })).status, 201);
      assert.equal(
        (
          await change({
            action: "updateApplicant",
            applicantId: people[0].id,
            name: "更正显示名称",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await change({
            action: "updateApplicant",
            applicantId: people[0].id,
            name: "更正显示名称",
            passportNo: "UNIQUE123",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await change({
            action: "updateApplicant",
            applicantId: people[1].id,
            name: "附属",
            passportNo: "UNIQUE123",
          })
        ).status,
        400,
      );

      if (uploadRoot) {
        const material = await db.query(
          "SELECT id FROM order_materials WHERE order_id=$1 AND applicant_id=$2 ORDER BY sequence LIMIT 1",
          [minimalOrder.id, people[0].id],
        );
        const fileId = `rollback_file_${tag}`;
        const originalRelativePath = `rollback-${tag}/original.jpg`;
        const originalPath = join(uploadRoot, originalRelativePath);
        await mkdir(dirname(originalPath), { recursive: true });
        await writeFile(originalPath, "rollback fixture");
        await db.query(`INSERT INTO material_files
          (id,order_id,material_id,original_name,stored_name,relative_path,mime_type,size_bytes,uploaded_at,sha256)
          VALUES($1,$2,$3,'original.jpg','original.jpg',$4,'image/jpeg',16,now(),$5)`,
          [fileId, minimalOrder.id, material.rows[0].id, originalRelativePath, "0".repeat(64)],
        );
        await db.query(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF position('ROLLBACK_${tag}' in COALESCE(NEW.changes_json,'')) > 0 THEN
              RAISE EXCEPTION 'injected audit failure';
            END IF;
            RETURN NEW;
          END $$`);
        await db.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs
          FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
        const rejected = await change({
          action: "updateApplicant",
          applicantId: people[0].id,
          name: `ROLLBACK_${tag}`,
        });
        assert.equal(rejected.status, 500, await rejected.clone().text());
        const persisted = await db.query(
          "SELECT relative_path FROM material_files WHERE id=$1",
          [fileId],
        );
        assert.equal(persisted.rows[0].relative_path, originalRelativePath);
        await access(originalPath);
        assert.deepEqual(
          (await readdir(rollbackDirectory, { recursive: true })).filter((name) => name.endsWith(".jpg")),
          ["original.jpg"],
        );
        assert.equal(
          (await readdir(uploadRoot, { recursive: true })).some((name) =>
            name.split("/").at(-1)?.includes(fileId.slice(-8)) && name.endsWith(".jpg"),
          ),
          false,
        );
        await db.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
        await db.query(`DROP FUNCTION ${triggerName}()`);
      }

      const userId = (
        await db.query("SELECT id FROM users WHERE username=$1", [username])
      ).rows[0].id;
      await db.query(
        "UPDATE user_sessions SET last_seen_at=now()-interval '20 minutes' WHERE user_id=$1",
        [userId],
      );
      const before = (
        await db.query(
          `SELECT last_seen_at::text FROM user_sessions
           WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [userId],
        )
      ).rows[0].last_seen_at;

      assert.equal(
        (await fetch(`${baseUrl}/api/admin/system`, { headers: { cookie } })).status,
        200,
      );
      const afterMonitoring = (
        await db.query(
          `SELECT last_seen_at::text FROM user_sessions
           WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [userId],
        )
      ).rows[0].last_seen_at;
      assert.equal(afterMonitoring, before);

      assert.equal(
        (await fetch(`${baseUrl}/api/data/orders`, { headers: { cookie } })).status,
        200,
      );
      const afterBusinessRequest = (
        await db.query(
          `SELECT last_seen_at::text FROM user_sessions
           WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [userId],
        )
      ).rows[0].last_seen_at;
      assert.notEqual(afterBusinessRequest, before);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`).catch(() => undefined);
      await db.query(`DROP FUNCTION IF EXISTS ${triggerName}()`).catch(() => undefined);
      for (const orderId of orderIds) {
        await db.query("DELETE FROM orders WHERE id=$1", [orderId]);
      }
      await db.query("DELETE FROM projects WHERE id=$1", [projectId]);
      await db.query("DELETE FROM agents WHERE id=$1", [agentId]);
      if (rollbackDirectory) await rm(rollbackDirectory, { recursive: true, force: true });
      await db.end();
    }
  },
);

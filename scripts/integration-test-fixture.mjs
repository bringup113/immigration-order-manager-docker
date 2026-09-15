import pg from "pg";

const action = process.argv[2];
const databaseUrl = process.env.MIGRA_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl || !["create", "delete"].includes(action)) {
  throw new Error(
    "用法：设置 MIGRA_DATABASE_URL 和 MIGRA_ALLOW_TEST_FIXTURES=1，然后运行 node scripts/integration-test-fixture.mjs create|delete。",
  );
}
if (process.env.MIGRA_ALLOW_TEST_FIXTURES !== "1") {
  throw new Error("拒绝修改数据库：仅允许在明确设置 MIGRA_ALLOW_TEST_FIXTURES=1 的隔离测试环境中运行。");
}

const fixture = {
  agentId: "agt_ci_fixture",
  projectId: "prj_ci_fixture",
  orderId: "ord_ci_fixture",
  orderNo: "CI-FIXTURE-2026091501",
  applicantId: "apl_ci_fixture",
  passportMaterialId: "mat_ci_passport",
  supportingMaterialId: "mat_ci_supporting",
  fileId: "fil_ci_fixture",
  planId: "plan_ci_fixture",
  cashId: "cash_ci_fixture",
};

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

async function removeFixture() {
  await client.query(
    `DELETE FROM audit_logs
      WHERE entity_id = ANY($1::text[])
         OR request_id LIKE 'ci-fixture:%'`,
    [[fixture.orderId, fixture.orderNo, fixture.fileId, fixture.planId, fixture.cashId]],
  );
  await client.query("DELETE FROM orders WHERE id=$1", [fixture.orderId]);
  await client.query("DELETE FROM projects WHERE id=$1", [fixture.projectId]);
  await client.query("DELETE FROM agents WHERE id=$1", [fixture.agentId]);
}

try {
  await client.query("BEGIN");
  await removeFixture();

  if (action === "create") {
    const owner = await client.query(
      "SELECT id FROM users WHERE id='usr_integration_test' AND active=1 AND role_id='role_owner'",
    );
    if (owner.rowCount !== 1) {
      throw new Error("未找到已启用的隔离集成测试所有者账号，请先创建测试账号。");
    }
    const ownerId = owner.rows[0].id;

    await client.query(
      `INSERT INTO agents (id,code,name,active,created_at,updated_at)
       VALUES ($1,'CI-AGENT','CI 固定测试代理',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [fixture.agentId],
    );
    await client.query(
      `INSERT INTO projects
        (id,code,name,country,default_receivable_currency,provider_currency,status,created_at,updated_at)
       VALUES ($1,'CI_FIXTURE','CI 固定测试项目','测试地区','USD','USD','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [fixture.projectId],
    );
    await client.query(
      `INSERT INTO orders
        (id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,
         project_revision,status,signed_at,owner_user_id,created_at,updated_at,status_changed_at)
       VALUES ($1,$2,$3,$4,'CI_FIXTURE','CI 固定测试项目','测试地区',1,'ACTIVE',CURRENT_DATE,$5,
         CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [fixture.orderId, fixture.orderNo, fixture.agentId, fixture.projectId, ownerId],
    );
    await client.query(
      `INSERT INTO order_applicants
        (id,order_id,applicant_type,name,surname,given_names,nationality,passport_no,birth_date,sex,
         passport_expiry,issuing_country,document_code,personal_number,sequence)
       VALUES ($1,$2,'MAIN','CI 主申请人','TEST','APPLICANT','CHN','CI0000001','1990-01-01','X',
         '2035-01-01','CHN','P','CI-PERSONAL',0)`,
      [fixture.applicantId, fixture.orderId],
    );
    await client.query(
      `INSERT INTO order_materials
        (id,order_id,applicant_id,name,required,sequence,system_code)
       VALUES ($1,$2,$3,'护照资料页',1,0,'PASSPORT_BIO_PAGE'),
              ($4,$2,$3,'CI 辅助材料',1,1,NULL)`,
      [
        fixture.passportMaterialId,
        fixture.orderId,
        fixture.applicantId,
        fixture.supportingMaterialId,
      ],
    );
    await client.query(
      `INSERT INTO material_files
        (id,order_id,material_id,original_name,stored_name,relative_path,mime_type,size_bytes,uploaded_at,sha256)
       VALUES ($1,$2,$3,'ci-fixture.pdf','ci-fixture.pdf','ci-fixture/ci-fixture.pdf',
         'application/pdf',4,CURRENT_TIMESTAMP,$4)`,
      [fixture.fileId, fixture.orderId, fixture.supportingMaterialId, "0".repeat(64)],
    );
    await client.query(
      `INSERT INTO order_steps
        (id,order_id,name,sequence,required,status,started_at,created_at,updated_at)
       VALUES ('step_ci_fixture_1',$1,'CI 当前流程',1,1,'IN_PROGRESS',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
              ('step_ci_fixture_2',$1,'CI 后续流程',2,1,'PENDING',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [fixture.orderId],
    );
    await client.query(
      `INSERT INTO order_plans
        (id,order_id,plan_type,sequence,name,currency,planned_amount_minor,budget_rate_scaled,planned_base_minor)
       VALUES ($1,$2,'RECEIVABLE',1,'CI 应收计划','USD',10000,100000000,10000)`,
      [fixture.planId, fixture.orderId],
    );
    await client.query(
      `INSERT INTO order_cash_entries
        (id,order_id,order_plan_id,direction,entry_date,description,currency,amount_minor,rate_scaled,
         base_amount_minor,plan_currency,plan_amount_minor,created_at,updated_at)
       VALUES ($1,$2,$3,'RECEIPT',CURRENT_DATE,'CI 测试收款','USD',5000,100000000,5000,'USD',5000,
         CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [fixture.cashId, fixture.orderId, fixture.planId],
    );
  }

  await client.query("COMMIT");
  process.stdout.write(action === "create" ? "隔离集成测试夹具已创建。\n" : "隔离集成测试夹具已清理。\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

import { getDatabase, newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";
import { toMinor } from "@/lib/amount";
import {
  addDays,
  DomainError,
  isOneOf,
  JsonRecord,
  MATERIAL_SCOPES,
  reserveOrderNumber,
  ORDER_STATUSES,
  PLAN_TYPES,
  rateForCurrency,
  textValue,
  toBaseMinor,
} from "@/lib/domain";
import {
  dateField,
  FIELD_LIMITS,
  recordArray,
  validateTextFields,
} from "@/lib/validation";

type TemplateRow = Record<string, unknown>;

export async function createOrder(
  body: JsonRecord,
  ownerUserId: string,
  db: AppDatabase = getDatabase(),
) {
  validateTextFields(body, [
    {
      key: "agentId",
      label: "代理来源",
      max: FIELD_LIMITS.code,
      required: true,
    },
    { key: "projectId", label: "项目", max: FIELD_LIMITS.code, required: true },
    { key: "notes", label: "订单备注", max: FIELD_LIMITS.notes },
  ]);
  const now = nowIso();
  const agentId = textValue(body, "agentId");
  const projectId = textValue(body, "projectId");
  if (!agentId || !projectId) throw new DomainError("请选择项目和代理来源。");

  const agent = await db
    .prepare("SELECT id FROM agents WHERE id=? AND active=1")
    .bind(agentId)
    .first();
  const project = await db
    .prepare("SELECT * FROM projects WHERE id=? AND status='ACTIVE'")
    .bind(projectId)
    .first();
  if (!agent || !project)
    throw new DomainError("所选代理或项目不存在，或已经停用。");
  const defaultProjectChannel = await db
    .prepare(
      "SELECT channel_id FROM project_channels WHERE project_id=? AND is_default=1 LIMIT 1",
    )
    .bind(projectId)
    .first();
  const defaultChannelId = defaultProjectChannel
    ? String(defaultProjectChannel.channel_id)
    : "";

  const signedAt = dateField(body, "signedAt", "签约日期") || now.slice(0, 10);
  const orderNo = await reserveOrderNumber(db, String(project.code), signedAt);
  const defaultReceivableCurrency = String(
    project.default_receivable_currency || "USD",
  );

  const [stepTemplates, planTemplates, materialTemplates] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM project_step_templates WHERE project_id=? ORDER BY sequence",
      )
      .bind(projectId)
      .all<TemplateRow>(),
    db
      .prepare(
        "SELECT * FROM project_plan_templates WHERE project_id=? ORDER BY CASE plan_type WHEN 'RECEIVABLE' THEN 1 ELSE 2 END,sequence",
      )
      .bind(projectId)
      .all<TemplateRow>(),
    db
      .prepare(
        "SELECT * FROM project_material_templates WHERE project_id=? ORDER BY sequence",
      )
      .bind(projectId)
      .all<TemplateRow>(),
  ]);

  const suppliedApplicants = recordArray(body.applicants, "申请人", 20).filter(
    (item) => textValue(item, "name"),
  );
  const mainApplicants = suppliedApplicants.filter(
    (item) => textValue(item, "applicantType") === "MAIN",
  );
  if (mainApplicants.length !== 1)
    throw new DomainError("每张订单必须且只能有一名主申请人。");
  const passportNumbers = suppliedApplicants.map((item) =>
    textValue(item, "passportNo").toUpperCase().replace(/\s+/g, ""),
  );
  if (passportNumbers.some((passportNo) => !passportNo))
    throw new DomainError("每位申请人都必须填写护照号码。");
  if (new Set(passportNumbers).size !== passportNumbers.length)
    throw new DomainError("同一订单内不能重复使用相同的护照号码。");

  const suppliedSteps = recordArray(body.steps, "办理流程", 100);
  const steps = suppliedSteps.length
    ? suppliedSteps
    : stepTemplates.results.map((row) => ({
        templateId: row.id,
        name: row.name,
        required: Boolean(row.required),
        dueDate: addDays(
          signedAt,
          row.due_days === null ? null : Number(row.due_days),
        ),
        notes: row.notes,
      }));
  const suppliedPlans = recordArray(body.plans, "收付款计划", 100);
  const plans = suppliedPlans.length
    ? suppliedPlans
    : planTemplates.results.map((row) => ({
        templateId: row.id,
        planType: row.plan_type,
        name: row.name,
        currency: row.currency,
        amountMinor: row.amount_minor,
        dueDate: addDays(
          signedAt,
          row.due_days === null ? null : Number(row.due_days),
        ),
        channelId: row.plan_type === "PAYABLE" ? defaultChannelId : "",
        notes: row.notes,
      }));
  const suppliedMaterials = recordArray(body.materials, "材料清单", 300);
  const materials = suppliedMaterials.length
    ? suppliedMaterials
    : materialTemplates.results.map((row) => ({
        templateId: row.id,
        name: row.name,
        scope: row.scope,
        required: Boolean(row.required),
        notes: row.notes,
      }));

  const id = newId("ord");
  const status = textValue(body, "status") || "DRAFT";
  if (!isOneOf(status, ORDER_STATUSES))
    throw new DomainError("订单状态不正确。");
  if (status !== "DRAFT")
    throw new DomainError(
      "新订单必须先保存为草稿，完成申请人护照资料后再开始办理。",
    );
  const statements = [
    db
      .prepare(
        "INSERT INTO orders (id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,project_revision,status,signed_at,notes,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        orderNo,
        agentId,
        projectId,
        project.code,
        project.name,
        project.country,
        Number(project.revision_no),
        status,
        signedAt,
        textValue(body, "notes") || null,
        ownerUserId,
        now,
        now,
      ),
  ];

  const applicants = suppliedApplicants.map((item, index) => ({
    id: newId("apl"),
    passportMaterialId: newId("mat"),
    clientKey: textValue(item, "clientKey"),
    item,
    index,
    applicantType:
      textValue(item, "applicantType") === "MAIN" ? "MAIN" : "DEPENDENT",
    passportNo: passportNumbers[index],
  }));
  applicants.forEach(
    ({ id: applicantId, item, index, applicantType, passportNo }) => {
      validateTextFields(item, [
        {
          key: "name",
          label: `第 ${index + 1} 位申请人姓名`,
          max: FIELD_LIMITS.name,
          required: true,
        },
        {
          key: "nationality",
          label: "国籍",
          max: FIELD_LIMITS.country,
          required: true,
        },
        {
          key: "passportNo",
          label: "护照号码",
          max: FIELD_LIMITS.passport,
          required: true,
        },
        {
          key: "relationship",
          label: "与主申请人关系",
          max: FIELD_LIMITS.shortName,
        },
        { key: "surname", label: "护照姓", max: FIELD_LIMITS.name },
        { key: "givenNames", label: "护照名", max: FIELD_LIMITS.name },
        {
          key: "issuingCountry",
          label: "签发国家或地区",
          max: FIELD_LIMITS.country,
        },
        { key: "documentCode", label: "证件类型", max: FIELD_LIMITS.code },
        {
          key: "personalNumber",
          label: "个人号码",
          max: FIELD_LIMITS.passport,
        },
      ]);
      const sex = textValue(item, "sex");
      if (sex && !["M", "F", "X"].includes(sex))
        throw new DomainError("申请人性别格式不正确。");
      statements.push(
        db
          .prepare(
            `INSERT INTO order_applicants
      (id,order_id,applicant_type,relationship,name,nationality,passport_no,sequence,surname,given_names,birth_date,sex,passport_expiry,issuing_country,document_code,personal_number)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            applicantId,
            id,
            applicantType,
            textValue(item, "relationship") || null,
            textValue(item, "name"),
            textValue(item, "nationality") || null,
            passportNo,
            index,
            textValue(item, "surname") || null,
            textValue(item, "givenNames") || null,
            dateField(item, "birthDate", "出生日期", true),
            sex || null,
            dateField(item, "passportExpiry", "护照有效期", true),
            textValue(item, "issuingCountry") || null,
            textValue(item, "documentCode") || null,
            textValue(item, "personalNumber") || null,
          ),
      );
    },
  );

  applicants.forEach(({ id: applicantId, passportMaterialId }) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO order_materials
      (id,order_id,template_id,applicant_id,name,required,expected_date,sequence,notes,system_code)
      VALUES (?,?,NULL,?,'护照首页',1,NULL,-100,'每位申请人的系统固定身份材料','PASSPORT_BIO_PAGE')`,
        )
        .bind(passportMaterialId, id, applicantId),
    );
  });

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    validateTextFields(step, [
      {
        key: "name",
        label: "流程步骤名称",
        max: FIELD_LIMITS.name,
        required: true,
      },
      { key: "notes", label: "流程备注", max: FIELD_LIMITS.notes },
    ]);
    const name = textValue(step, "name");
    if (!name) throw new DomainError("流程步骤名称不能为空。");
    const stepStatus = "PENDING";
    const dueDate = dateField(step, "dueDate", "流程预计日期");
    statements.push(
      db
        .prepare(
          "INSERT INTO order_steps (id,order_id,template_id,name,sequence,required,status,due_date,started_at,completed_at,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?)",
        )
        .bind(
          newId("stp"),
          id,
          textValue(step, "templateId") || null,
          name,
          index + 1,
          step.required === false ? 0 : 1,
          stepStatus,
          dueDate,
          null,
          textValue(step, "notes") || null,
          now,
          now,
        ),
    );
  }

  const currencyRates = new Map<string, number>();
  const planSequences: Record<string, number> = {};
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    validateTextFields(plan, [
      {
        key: "name",
        label: "收付款阶段名称",
        max: FIELD_LIMITS.name,
        required: true,
      },
      { key: "notes", label: "收付款备注", max: FIELD_LIMITS.notes },
    ]);
    const planType = textValue(plan, "planType");
    const name = textValue(plan, "name");
    const currency = textValue(plan, "currency") || defaultReceivableCurrency;
    const amountMinor =
      typeof plan.amountMinor === "number"
        ? Math.round(plan.amountMinor)
        : toMinor((plan as JsonRecord).amount);
    if (!isOneOf(planType, PLAN_TYPES) || !name || amountMinor <= 0)
      throw new DomainError(
        "每个收付款阶段都必须有类型、名称和大于 0 的金额。",
      );
    const rateScaled =
      currencyRates.get(currency) ?? (await rateForCurrency(db, currency));
    if (rateScaled) currencyRates.set(currency, rateScaled);
    if (!rateScaled)
      throw new DomainError(
        `没有可用的 ${currency} 汇率，请先在系统设置中维护。`,
      );
    const sequence = (planSequences[planType] || 0) + 1;
    planSequences[planType] = sequence;
    statements.push(
      db
        .prepare(
          "INSERT INTO order_plans (id,order_id,template_id,plan_type,sequence,name,currency,planned_amount_minor,budget_rate_scaled,planned_base_minor,due_date,channel_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          newId("pln"),
          id,
          textValue(plan, "templateId") || null,
          planType,
          sequence,
          name,
          currency,
          amountMinor,
          rateScaled,
          toBaseMinor(amountMinor, rateScaled),
          dateField(plan, "dueDate", "收付款计划日期"),
          textValue(plan, "channelId") || null,
          textValue(plan, "notes") || null,
        ),
    );
  }

  const materialSequences = new Map<string, number>();
  materials.forEach((item) => {
    validateTextFields(item, [
      {
        key: "name",
        label: "材料名称",
        max: FIELD_LIMITS.name,
        required: true,
      },
      { key: "notes", label: "材料备注", max: FIELD_LIMITS.notes },
    ]);
    const name = textValue(item, "name");
    const scope = textValue(item, "scope") || "ALL";
    if (!name || !isOneOf(scope, MATERIAL_SCOPES))
      throw new DomainError("材料名称或适用范围不正确。");
    const targets =
      scope === "COMMON"
        ? [null]
        : applicants
            .filter(
              (applicant) =>
                scope === "ALL" ||
                (scope === "MAIN" && applicant.applicantType === "MAIN") ||
                (scope === "DEPENDENT" &&
                  applicant.applicantType === "DEPENDENT"),
            )
            .map((applicant) => applicant.id);
    targets.forEach((applicantId) => {
      const ownerKey = applicantId || "COMMON";
      const sequence = materialSequences.get(ownerKey) ?? 0;
      materialSequences.set(ownerKey, sequence + 1);
      statements.push(
        db
          .prepare(
            "INSERT INTO order_materials (id,order_id,template_id,applicant_id,name,required,expected_date,sequence,notes) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            newId("mat"),
            id,
            textValue(item, "templateId") || null,
            applicantId,
            name,
            item.required === false ? 0 : 1,
            dateField(item, "expectedDate", "材料预计日期"),
            sequence,
            textValue(item, "notes") || null,
          ),
      );
    });
  });

  statements.push(
    db
      .prepare(
        "INSERT INTO order_progress (id,order_id,progress_date,title,details,next_action,follow_up_date,follow_up_done,pinned,created_at) VALUES (?,?,?,?,?,?,?,1,0,?)",
      )
      .bind(
        newId("pro"),
        id,
        signedAt,
        "订单已创建",
        `已从项目模板 V${project.revision_no} 建立订单独立副本。`,
        null,
        null,
        now,
      ),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique"))
      throw new DomainError("订单编号已经存在。", 409);
    throw error;
  }
  return {
    id,
    orderNo,
    applicants: applicants.map(
      ({ id: applicantId, passportMaterialId, clientKey }) => ({
        id: applicantId,
        passportMaterialId,
        clientKey,
      }),
    ),
  };
}

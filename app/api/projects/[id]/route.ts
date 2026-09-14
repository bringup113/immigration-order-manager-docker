import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { mutationTransaction } from "@/lib/api-transaction";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase, newId, nowIso } from "@/db/database";
import { toMinor } from "@/lib/amount";
import { DomainError, isOneOf, MATERIAL_SCOPES, PLAN_TYPES, positiveInteger, requireActiveCurrency, textValue } from "@/lib/domain";
import { authorizeApiUser, jsonError, requireApiUser, requireMutationUser } from "@/lib/api-auth";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import type { AppDatabase } from "@/db/driver";
import { FIELD_LIMITS, validateTextFields } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
type Body = Record<string, unknown>;

function handleError(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("项目保存失败，请检查填写内容。", 500);
}

export async function GET(_request: NextRequest, context: Context) {
  const auth = await requireApiUser("projects.read");
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const db = getDatabase();
  const project = await db.prepare(`SELECT p.*,p.description AS notes,
    (SELECT pc.channel_id FROM project_channels pc WHERE pc.project_id=p.id AND pc.is_default=1 LIMIT 1) AS default_channel_id
    FROM projects p WHERE p.id=?`).bind(id).first();
  if (!project) return jsonError("项目不存在。", 404);
  const [steps, plans, materials, channels, projectChannels, currencies] = await Promise.all([
    db.prepare("SELECT * FROM project_step_templates WHERE project_id=? ORDER BY sequence").bind(id).all(),
    db.prepare("SELECT p.*,p.sequence AS stage_no FROM project_plan_templates p WHERE p.project_id=? ORDER BY CASE p.plan_type WHEN 'RECEIVABLE' THEN 1 ELSE 2 END,p.sequence").bind(id).all(),
    db.prepare("SELECT *,sequence AS sort_order FROM project_material_templates WHERE project_id=? ORDER BY sequence").bind(id).all(),
    db.prepare("SELECT id,name,settlement_currency,country FROM channels WHERE active=1 ORDER BY name").all(),
    db.prepare("SELECT pc.*,c.name,c.settlement_currency FROM project_channels pc JOIN channels c ON c.id=pc.channel_id WHERE pc.project_id=? ORDER BY pc.is_default DESC,c.name").bind(id).all(),
    db.prepare("SELECT currency,name FROM exchange_rates WHERE active=1 ORDER BY CASE WHEN currency='USD' THEN 0 ELSE 1 END,currency").all(),
  ]);
  return NextResponse.json({ project, steps: steps.results, plans: plans.results, materials: materials.results, channels: channels.results, projectChannels: projectChannels.results, currencies: currencies.results });
}

async function projectActionSnapshot(db: AppDatabase, projectId: string, body: Body) {
  const project = await db.prepare("SELECT * FROM projects WHERE id=?").bind(projectId).first();
  if (!project) return null;
  const action = textValue(body, "action");
  const templateId = textValue(body, "templateId");
  const requestedType = textValue(body, "type");
  const table = action === "updateStep" || (action === "moveTemplate" && requestedType === "step") || (action === "removeTemplate" && requestedType === "step")
    ? "project_step_templates"
    : action === "updatePlan" || (action === "moveTemplate" && requestedType === "plan") || (action === "removeTemplate" && requestedType === "plan")
      ? "project_plan_templates"
      : action === "updateMaterial" || (action === "removeTemplate" && requestedType === "material") ? "project_material_templates" : "";
  const target = table && templateId ? await db.prepare(`SELECT * FROM ${table} WHERE id=? AND project_id=?`).bind(templateId, projectId).first() : null;
  const channels = ["update", "defaultChannel", "channel"].includes(action)
    ? (await db.prepare("SELECT channel_id,is_default FROM project_channels WHERE project_id=? ORDER BY channel_id").bind(projectId).all()).results : undefined;
  return { project, target, channels };
}

async function handlePost(context: Context, body: Body, user: ChatGPTUser, rootDb: AppDatabase = getDatabase()) {
  const auth = authorizeApiUser(user, "projects.write");
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    return await rootDb.transaction(async (db) => {
    const exists = await db.prepare("SELECT id,version FROM projects WHERE id=? FOR UPDATE").bind(id).first();
    if (!exists) return jsonError("项目不存在。", 404);
    const expectedVersion = Number(body.expectedVersion);
    if (Number.isFinite(expectedVersion) && expectedVersion !== Number(exists.version)) {
      return jsonError("此项目刚刚被其他用户修改，页面已刷新为最新内容，请确认后重试。", 409);
    }
    const action = textValue(body, "action");
    const now = nowIso();
    validateTextFields(body, [
      { key: "action", label: "操作类型", max: FIELD_LIMITS.code, required: true }, { key: "templateId", label: "模板编号", max: FIELD_LIMITS.code },
      { key: "channelId", label: "渠道编号", max: FIELD_LIMITS.code }, { key: "name", label: "名称", max: FIELD_LIMITS.name },
      { key: "country", label: "国家或地区", max: FIELD_LIMITS.country }, { key: "notes", label: "说明", max: FIELD_LIMITS.notes },
    ]);
    if (action === "update") {
      const name = textValue(body, "name");
      const country = textValue(body, "country");
      const status = textValue(body, "status") || "ACTIVE";
      if (!name || !country || !["ACTIVE", "INACTIVE"].includes(status)) throw new DomainError("请填写项目名称、国家和正确状态。");
      const [receivableCurrency, providerCurrency] = await Promise.all([
        requireActiveCurrency(db, textValue(body, "receivableCurrency") || "USD"),
        requireActiveCurrency(db, textValue(body, "providerCurrency") || "USD"),
      ]);
      const defaultChannelId = textValue(body, "defaultChannelId");
      if (defaultChannelId) {
        const linked = await db.prepare("SELECT 1 FROM project_channels pc JOIN channels c ON c.id=pc.channel_id WHERE pc.project_id=? AND pc.channel_id=? AND c.active=1").bind(id, defaultChannelId).first();
        if (!linked) throw new DomainError("默认渠道必须是该项目已关联且启用中的渠道商。");
      }
      const statements = [
        db.prepare("UPDATE projects SET name=?,country=?,default_receivable_currency=?,provider_currency=?,status=?,description=?,revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?")
          .bind(name, country, receivableCurrency, providerCurrency, status, textValue(body, "notes") || null, now, id),
        db.prepare("UPDATE project_channels SET is_default=0 WHERE project_id=?").bind(id),
      ];
      if (defaultChannelId) statements.push(db.prepare("UPDATE project_channels SET is_default=1 WHERE project_id=? AND channel_id=?").bind(id, defaultChannelId));
      await db.batch(statements);
      return NextResponse.json({ ok: true });
    }
    if (action === "defaultChannel") {
      const channelId = textValue(body, "channelId");
      if (channelId) {
        const linked = await db.prepare("SELECT 1 FROM project_channels pc JOIN channels c ON c.id=pc.channel_id WHERE pc.project_id=? AND pc.channel_id=? AND c.active=1").bind(id, channelId).first();
        if (!linked) throw new DomainError("只能把该项目已关联且启用中的渠道商设为默认渠道。");
      }
      const statements = [db.prepare("UPDATE project_channels SET is_default=0 WHERE project_id=?").bind(id)];
      if (channelId) statements.push(db.prepare("UPDATE project_channels SET is_default=1 WHERE project_id=? AND channel_id=?").bind(id, channelId));
      statements.push(db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id));
      await db.batch(statements);
      return NextResponse.json({ ok: true });
    }
    if (action === "channel") {
      const channelId = textValue(body, "channelId");
      if (!channelId) throw new DomainError("请选择渠道商。");
      const channel = await db.prepare("SELECT id FROM channels WHERE id=? AND active=1").bind(channelId).first();
      if (!channel) throw new DomainError("渠道商不存在或已停用。");
      const isDefault = body.isDefault === true;
      const statements = [];
      if (isDefault) statements.push(db.prepare("UPDATE project_channels SET is_default=0 WHERE project_id=?").bind(id));
      statements.push(db.prepare("INSERT INTO project_channels (id,project_id,channel_id,is_default) VALUES (?,?,?,?) ON CONFLICT(project_id,channel_id) DO UPDATE SET is_default=excluded.is_default").bind(newId("pch"), id, channelId, isDefault ? 1 : 0));
      statements.push(db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id));
      await db.batch(statements);
      return NextResponse.json({ ok: true });
    }
    if (action === "moveTemplate") {
      const type = textValue(body, "type");
      const templateId = textValue(body, "templateId");
      const direction = textValue(body, "direction");
      if (!templateId || !["step", "plan"].includes(type) || !["UP", "DOWN"].includes(direction)) throw new DomainError("排序操作不正确。");
      if (type === "step") {
        const current = await db.prepare("SELECT id,sequence FROM project_step_templates WHERE id=? AND project_id=?").bind(templateId, id).first();
        if (!current) throw new DomainError("流程步骤不存在。", 404);
        const target = direction === "UP"
          ? await db.prepare("SELECT id,sequence FROM project_step_templates WHERE project_id=? AND sequence<? ORDER BY sequence DESC LIMIT 1").bind(id, current.sequence).first()
          : await db.prepare("SELECT id,sequence FROM project_step_templates WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT 1").bind(id, current.sequence).first();
        if (target) await db.batch([
          db.prepare("UPDATE project_step_templates SET sequence=? WHERE id=? AND project_id=?").bind(target.sequence, current.id, id),
          db.prepare("UPDATE project_step_templates SET sequence=? WHERE id=? AND project_id=?").bind(current.sequence, target.id, id),
          db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
        ]);
        return NextResponse.json({ ok: true });
      }
      const current = await db.prepare("SELECT id,plan_type,sequence FROM project_plan_templates WHERE id=? AND project_id=?").bind(templateId, id).first();
      if (!current) throw new DomainError("收付款方案不存在。", 404);
      const target = direction === "UP"
        ? await db.prepare("SELECT id,sequence FROM project_plan_templates WHERE project_id=? AND plan_type=? AND sequence<? ORDER BY sequence DESC LIMIT 1").bind(id, current.plan_type, current.sequence).first()
        : await db.prepare("SELECT id,sequence FROM project_plan_templates WHERE project_id=? AND plan_type=? AND sequence>? ORDER BY sequence LIMIT 1").bind(id, current.plan_type, current.sequence).first();
      if (target) await db.batch([
        db.prepare("UPDATE project_plan_templates SET sequence=? WHERE id=? AND project_id=?").bind(target.sequence, current.id, id),
        db.prepare("UPDATE project_plan_templates SET sequence=? WHERE id=? AND project_id=?").bind(current.sequence, target.id, id),
        db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (action === "step" || action === "updateStep") {
      const name = textValue(body, "name");
      const dueDays = textValue(body, "dueDays") ? positiveInteger(body.dueDays) : null;
      if (!name || (textValue(body, "dueDays") && dueDays === null)) throw new DomainError("请填写步骤名称和正确的计划天数。");
      if (action === "updateStep") {
        const templateId = textValue(body, "templateId");
        if (!templateId || !await db.prepare("SELECT 1 FROM project_step_templates WHERE id=? AND project_id=?").bind(templateId, id).first()) throw new DomainError("流程步骤不存在。", 404);
        await db.batch([
          db.prepare("UPDATE project_step_templates SET name=?,required=?,due_days=?,notes=? WHERE id=? AND project_id=?").bind(name, body.required === false ? 0 : 1, dueDays, textValue(body, "notes") || null, templateId, id),
          db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
        ]);
        return NextResponse.json({ ok: true });
      }
      const next = await db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS value FROM project_step_templates WHERE project_id=?").bind(id).first();
      await db.batch([
        db.prepare("INSERT INTO project_step_templates (id,project_id,name,sequence,required,due_days,notes) VALUES (?,?,?,?,?,?,?)").bind(newId("pst"), id, name, Number(next?.value ?? 1), body.required === false ? 0 : 1, dueDays, textValue(body, "notes") || null),
        db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (action === "plan" || action === "updatePlan") {
      const planType = textValue(body, "planType");
      const name = textValue(body, "name");
      const amountMinor = toMinor(body.amount);
      const dueDays = textValue(body, "dueDays") ? positiveInteger(body.dueDays) : null;
      if (!isOneOf(planType, PLAN_TYPES) || !name || amountMinor < 0 || (textValue(body, "dueDays") && dueDays === null)) throw new DomainError("请完整填写阶段类型、名称和金额。");
      const currency = await requireActiveCurrency(db, textValue(body, "currency") || "USD");
      if (action === "updatePlan") {
        const templateId = textValue(body, "templateId");
        const existing = templateId ? await db.prepare("SELECT id,plan_type,sequence FROM project_plan_templates WHERE id=? AND project_id=?").bind(templateId, id).first() : null;
        if (!existing) throw new DomainError("收付款方案不存在。", 404);
        let sequence = Number(existing.sequence);
        if (String(existing.plan_type) !== planType) {
          const next = await db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS value FROM project_plan_templates WHERE project_id=? AND plan_type=?").bind(id, planType).first();
          sequence = Number(next?.value ?? 1);
        }
        await db.batch([
          db.prepare("UPDATE project_plan_templates SET plan_type=?,sequence=?,name=?,currency=?,amount_minor=?,due_days=?,channel_id=NULL,notes=? WHERE id=? AND project_id=?")
            .bind(planType, sequence, name, currency, amountMinor, dueDays, textValue(body, "notes") || null, templateId, id),
          db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
        ]);
        return NextResponse.json({ ok: true });
      }
      const next = await db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS value FROM project_plan_templates WHERE project_id=? AND plan_type=?").bind(id, planType).first();
      await db.batch([
        db.prepare("INSERT INTO project_plan_templates (id,project_id,plan_type,sequence,name,currency,amount_minor,due_days,channel_id,notes) VALUES (?,?,?,?,?,?,?,?,NULL,?)")
          .bind(newId("ppt"), id, planType, Number(next?.value ?? 1), name, currency, amountMinor, dueDays, textValue(body, "notes") || null),
        db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (action === "material" || action === "updateMaterial") {
      const name = textValue(body, "name");
      const scope = textValue(body, "scope") || "ALL";
      if (!name || !isOneOf(scope, MATERIAL_SCOPES)) throw new DomainError("请填写材料名称和正确的适用范围。");
      if (action === "updateMaterial") {
        const templateId = textValue(body, "templateId");
        if (!templateId || !await db.prepare("SELECT 1 FROM project_material_templates WHERE id=? AND project_id=?").bind(templateId, id).first()) throw new DomainError("材料模板不存在。", 404);
        await db.batch([
          db.prepare("UPDATE project_material_templates SET name=?,scope=?,required=?,notes=? WHERE id=? AND project_id=?").bind(name, scope, body.required === false ? 0 : 1, textValue(body, "notes") || null, templateId, id),
          db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
        ]);
        return NextResponse.json({ ok: true });
      }
      const next = await db.prepare("SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM project_material_templates WHERE project_id=?").bind(id).first();
      await db.batch([
        db.prepare("INSERT INTO project_material_templates (id,project_id,name,scope,required,sequence,notes) VALUES (?,?,?,?,?,?,?)")
          .bind(newId("pmt"), id, name, scope, body.required === false ? 0 : 1, Number(next?.value ?? 0), textValue(body, "notes") || null),
        db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (action === "importMaterials") {
      const catalogAuth = authorizeApiUser(user, "material_catalog.read");
      if (catalogAuth.response) return catalogAuth.response;
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (!rawItems.length || rawItems.length > 200) throw new DomainError("请勾选 1–200 项材料。");
      const next = await db.prepare("SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM project_material_templates WHERE project_id=?").bind(id).first();
      let sequence = Number(next?.value ?? 0);
      const statements = [];
      let skipped = 0;
      for (const rawItem of rawItems) {
        if (!rawItem || typeof rawItem !== "object") throw new DomainError("材料选择内容格式不正确。");
        const item = rawItem as Record<string, unknown>;
        const catalogId = textValue(item, "catalogId");
        const catalog = catalogId ? await db.prepare("SELECT id,name,default_scope,default_required,description FROM material_catalog WHERE id=? AND active=1").bind(catalogId).first() : null;
        if (!catalog) throw new DomainError("所选材料不存在或已停用，请刷新后重试。", 409);
        const duplicate = await db.prepare("SELECT 1 FROM project_material_templates WHERE project_id=? AND lower(trim(name))=lower(trim(?)) LIMIT 1").bind(id, catalog.name).first();
        if (duplicate) { skipped += 1; continue; }
        const scope = textValue(item, "scope") || String(catalog.default_scope);
        if (!isOneOf(scope, MATERIAL_SCOPES)) throw new DomainError("材料适用范围不正确。");
        const required = typeof item.required === "boolean" ? item.required : Boolean(catalog.default_required);
        statements.push(db.prepare("INSERT INTO project_material_templates (id,project_id,name,scope,required,sequence,notes) VALUES (?,?,?,?,?,?,?)")
          .bind(newId("pmt"), id, catalog.name, scope, required ? 1 : 0, sequence, catalog.description || null));
        sequence += 1;
      }
      if (!statements.length) throw new DomainError("所选材料已经全部在当前项目中，无需重复添加。", 409);
      statements.push(db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id));
      await db.batch(statements);
      return NextResponse.json({ ok: true, added: statements.length - 1, skipped });
    }
    if (action === "removeTemplate") {
      const type = textValue(body, "type");
      const templateId = textValue(body, "templateId");
      const table = type === "step" ? "project_step_templates" : type === "plan" ? "project_plan_templates" : type === "material" ? "project_material_templates" : null;
      if (!table || !templateId) throw new DomainError("模板类型不正确。");
      await db.batch([
        db.prepare(`DELETE FROM ${table} WHERE id=? AND project_id=?`).bind(templateId, id),
        db.prepare("UPDATE projects SET revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?").bind(now, id),
      ]);
      return NextResponse.json({ ok: true });
    }
    throw new DomainError("不支持该操作。");
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const body = await request.json().catch(() => ({})) as Body;
  const { id } = await context.params;
  const auth = await requireMutationUser(request);
  if (auth.response) return auth.response;
  const actionCode = `PROJECT_${textValue(body, "action").toUpperCase() || "UPDATE"}`;
  try {
    const response = await mutationTransaction(async (db) => {
      const before = await projectActionSnapshot(db, id, body);
      const result = await handlePost(context, body, auth.user, db);
      if (!result.ok || !auth.user) return result;
      const after = await projectActionSnapshot(db, id, body);
      await writeAudit(request, auth.user, { action: actionCode, entityType: "PROJECT", entityId: id,
        entityLabel: textValue(body, "name") || String(before?.project?.name || id), summary: "项目配置操作", changes: { before, after, submitted: body } }, db);
      return result;
    });
    if (!response.ok && auth.user) await writeAuditBestEffort(request, auth.user, { action: actionCode, entityType: "PROJECT", entityId: id,
      entityLabel: textValue(body, "name") || id, result: "FAILURE", summary: "尝试项目配置操作", changes: { submitted: body } });
    return response;
  } catch (error) {
    if (auth.user) await writeAuditBestEffort(request, auth.user, { action: actionCode, entityType: "PROJECT", entityId: id,
      entityLabel: textValue(body, "name") || id, result: "FAILURE", summary: "尝试项目配置操作", changes: { submitted: body } });
    return handleError(error);
  }
}

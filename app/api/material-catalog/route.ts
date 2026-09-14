import { mutationTransaction } from "@/lib/api-transaction";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase, newId, nowIso } from "@/db/database";
import { jsonError, requireApiUser, requireMutationUser } from "@/lib/api-auth";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { DomainError, isOneOf, MATERIAL_SCOPES, textValue } from "@/lib/domain";
import type { AppDatabase } from "@/db/driver";
import { FIELD_LIMITS, validateTextFields } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Body = Record<string, unknown>;

function normalizedName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function handleError(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  if (String(error).toLowerCase().includes("unique")) return jsonError("材料名称已经存在，请直接修改现有材料。", 409);
  console.error(error);
  return jsonError("材料库保存失败，请稍后重试。", 500);
}

export async function GET() {
  const auth = await requireApiUser("material_catalog.read");
  if (auth.response) return auth.response;
  const result = await getDatabase().prepare("SELECT * FROM material_catalog ORDER BY sequence,name").all();
  return NextResponse.json(result.results);
}

async function handlePost(body: Body, db: AppDatabase = getDatabase()) {
  const action = textValue(body, "action");
  const now = nowIso();
  try {
    validateTextFields(body, [
      { key: "action", label: "操作类型", max: FIELD_LIMITS.code, required: true }, { key: "id", label: "材料编号", max: FIELD_LIMITS.code },
      { key: "name", label: "材料名称", max: 120 }, { key: "category", label: "分类", max: 60 },
      { key: "description", label: "说明", max: FIELD_LIMITS.description },
    ]);
    if (action === "create") {
      const name = textValue(body, "name");
      const scope = textValue(body, "defaultScope") || "ALL";
      if (!name || name.length > 120 || !isOneOf(scope, MATERIAL_SCOPES)) throw new DomainError("请填写 120 字以内的材料名称和正确的默认适用范围。");
      const id = newId("mcat");
      const next = await db.prepare("SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM material_catalog").first();
      await db.prepare(`INSERT INTO material_catalog
        (id,name,name_normalized,category,default_scope,default_required,description,active,sequence,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,1,?,1,?,?)`)
        .bind(id, name, normalizedName(name), textValue(body, "category").slice(0, 60) || null, scope, body.defaultRequired === false ? 0 : 1, textValue(body, "description").slice(0, 1000) || null, Number(next?.value ?? 0), now, now).run();
      return NextResponse.json({ id }, { status: 201 });
    }
    if (action === "update") {
      const id = textValue(body, "id");
      const name = textValue(body, "name");
      const scope = textValue(body, "defaultScope") || "ALL";
      if (!id || !name || name.length > 120 || !isOneOf(scope, MATERIAL_SCOPES)) throw new DomainError("请填写 120 字以内的材料名称和正确的默认适用范围。");
      const existing = await db.prepare("SELECT id FROM material_catalog WHERE id=?").bind(id).first();
      if (!existing) throw new DomainError("材料不存在。", 404);
      await db.prepare(`UPDATE material_catalog SET name=?,name_normalized=?,category=?,default_scope=?,default_required=?,description=?,version=version+1,updated_at=? WHERE id=?`)
        .bind(name, normalizedName(name), textValue(body, "category").slice(0, 60) || null, scope, body.defaultRequired === false ? 0 : 1, textValue(body, "description").slice(0, 1000) || null, now, id).run();
      return NextResponse.json({ ok: true });
    }
    if (action === "activate" || action === "deactivate") {
      const id = textValue(body, "id");
      if (!id || !await db.prepare("SELECT id FROM material_catalog WHERE id=?").bind(id).first()) throw new DomainError("材料不存在。", 404);
      await db.prepare("UPDATE material_catalog SET active=?,version=version+1,updated_at=? WHERE id=?").bind(action === "activate" ? 1 : 0, now, id).run();
      return NextResponse.json({ ok: true });
    }
    if (action === "move") {
      const id = textValue(body, "id");
      const direction = textValue(body, "direction");
      if (!id || !["UP", "DOWN"].includes(direction)) throw new DomainError("材料排序参数不正确。");
      const current = await db.prepare("SELECT id,sequence FROM material_catalog WHERE id=?").bind(id).first();
      if (!current) throw new DomainError("材料不存在。", 404);
      const target = direction === "UP"
        ? await db.prepare("SELECT id,sequence FROM material_catalog WHERE sequence<? ORDER BY sequence DESC LIMIT 1").bind(current.sequence).first()
        : await db.prepare("SELECT id,sequence FROM material_catalog WHERE sequence>? ORDER BY sequence LIMIT 1").bind(current.sequence).first();
      if (!target) return NextResponse.json({ ok: true });
      await db.batch([
        db.prepare("UPDATE material_catalog SET sequence=?,version=version+1,updated_at=? WHERE id=?").bind(target.sequence, now, current.id),
        db.prepare("UPDATE material_catalog SET sequence=?,version=version+1,updated_at=? WHERE id=?").bind(current.sequence, now, target.id),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      const id = textValue(body, "id");
      if (!id || !await db.prepare("SELECT id FROM material_catalog WHERE id=?").bind(id).first()) throw new DomainError("材料不存在。", 404);
      await db.prepare("DELETE FROM material_catalog WHERE id=?").bind(id).run();
      return NextResponse.json({ ok: true });
    }
    throw new DomainError("不支持该材料库操作。");
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.clone().json().catch(() => null) as Body | null;
  if (!body) return jsonError("提交内容格式不正确。");
  const auth = await requireMutationUser(request, "material_catalog.write");
  if(auth.response)return auth.response;
  const action = textValue(body, "action").toUpperCase() || "UPDATE";
  const actionCode = `MATERIAL_CATALOG_${action}`;
  const verb = action === "CREATE" ? "新增" : action === "DEACTIVATE" ? "停用" : action === "ACTIVATE" ? "启用" : action === "DELETE" ? "删除" : action === "MOVE" ? "排序" : "修改";
  try {
    const response = await mutationTransaction(async (db) => {
      const sourceId = textValue(body, "id");
      const before = sourceId ? await db.prepare("SELECT * FROM material_catalog WHERE id=?").bind(sourceId).first() : null;
      const result = await handlePost(body, db);
      if (!result.ok || !auth.user) return result;
      const responseData = await result.clone().json().catch(() => ({})) as Record<string, unknown>;
      const entityId = String(responseData.id || sourceId) || null;
      const after = entityId ? await db.prepare("SELECT * FROM material_catalog WHERE id=?").bind(entityId).first() : null;
      await writeAudit(request, auth.user, { action: actionCode, entityType: "MATERIAL_CATALOG", entityId,
        entityLabel: textValue(body, "name") || String(before?.name || after?.name || "") || null,
        summary: `${verb}材料库条目`, changes: { before, after, submitted: body } }, db);
      return result;
    });
    if (!response.ok && auth.user) await writeAuditBestEffort(request, auth.user, { action: actionCode, entityType: "MATERIAL_CATALOG", result: "FAILURE", summary: `尝试${verb}材料库条目`, changes: { submitted: body } });
    return response;
  } catch (error) {
    if (auth.user) await writeAuditBestEffort(request, auth.user, { action: actionCode, entityType: "MATERIAL_CATALOG", result: "FAILURE", summary: `尝试${verb}材料库条目`, changes: { submitted: body } });
    return handleError(error);
  }
}

import { Readable } from "node:stream";
import { byteRange } from "@/lib/byte-range";
import { acquireTransfer } from "@/lib/file-transfer";
import { NextResponse } from "next/server";
import { getDatabase, nowIso } from "@/db/database";
import { openStoredFile } from "@/lib/file-storage";
import { DomainError } from "@/lib/domain";
import { jsonError, requireApiUser, requireMutationUser } from "@/lib/api-auth";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { orderScopeFilter } from "@/lib/order-access";
import type { AppUser } from "@/lib/docker-auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("文件操作失败，请稍后重试。", 500);
}

async function fileRow(id: string, user: AppUser) {
  const scope = orderScopeFilter(user, "o");
  return getDatabase().prepare(`SELECT f.*,m.system_code,m.applicant_id FROM material_files f
    JOIN order_materials m ON m.id=f.material_id JOIN orders o ON o.id=f.order_id
    WHERE f.id=? AND ${scope.sql}`).bind(id, ...scope.values).first();
}

export async function GET(request: Request, context: Context) {
  const download = new URL(request.url).searchParams.get("download") === "1";
  const auth = await requireApiUser(download ? "materials.download" : "materials.read");
  if (auth.response) return auth.response;
  let release: (() => void) | undefined;
  let file: Awaited<ReturnType<typeof openStoredFile>> | undefined;
  try {
    const { id } = await context.params;
    const row = await fileRow(id, auth.user);
    if (!row) throw new DomainError("文件记录不存在。", 404);
    release=acquireTransfer("download",8);
    file=await openStoredFile(String(row.relative_path));
    const stat=await file.stat();
    const rangeHeader=request.headers.get("if-range") ? null : request.headers.get("range");
    const range=rangeHeader ? byteRange(rangeHeader,stat.size) : undefined;
    if(rangeHeader && !range) {
      await file.close();release();
      return new NextResponse(null,{status:416,headers:{"Content-Range":`bytes */${stat.size}`,"Cache-Control":"private, no-store"}});
    }
    const fallback = String(row.stored_name).replace(/[^A-Za-z0-9._-]/g, "_");
    const encoded = encodeURIComponent(String(row.stored_name));
    const disposition = download ? "attachment" : "inline";
    await writeAuditBestEffort(request, auth.user, { action: download ? "MATERIAL_FILE_DOWNLOAD" : "MATERIAL_FILE_PREVIEW", entityType: "MATERIAL_FILE", entityId: id, entityLabel: String(row.stored_name), summary: `${download ? "下载" : "预览"}材料文件 ${row.stored_name}` });
    const stream=file.createReadStream({highWaterMark:64*1024,...(range || {})});
    const done=release;
    const abort=()=>stream.destroy();
    request.signal.addEventListener("abort",abort,{once:true});
    stream.once("close",()=>{request.signal.removeEventListener("abort",abort);done();});
    if(request.signal.aborted)stream.destroy();
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status:range?206:200, headers: {
      "Accept-Ranges":"bytes",
      ...(range ? {"Content-Range":`bytes ${range.start}-${range.end}/${stat.size}`} : {}),
      "Content-Type": String(row.mime_type),
      "Content-Length": String(range ? range.end-range.start+1 : stat.size),
      "Content-Disposition": `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    await file?.close().catch(()=>undefined);
    release?.();
    const { id } = await context.params;
    await writeAuditBestEffort(request, auth.user, { action: download ? "MATERIAL_FILE_DOWNLOAD" : "MATERIAL_FILE_PREVIEW", entityType: "MATERIAL_FILE", entityId: id, result: "FAILURE", summary: `尝试${download ? "下载" : "预览"}材料文件` });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return jsonError("提交内容格式不正确。");
  const action = String(body.action || "").trim().toUpperCase();
  const permission = action === "RESTORE" ? "materials.restore" : "materials.write";
  const auth = await requireMutationUser(request, permission);
  if (auth.response) return auth.response;
  const auditAction = action === "RESTORE" ? "MATERIAL_FILE_RESTORE" : "MATERIAL_FILE_VOID";
  try {
    const { id } = await context.params;
    if (!['VOID', 'RESTORE'].includes(action)) throw new DomainError("文件状态操作不正确。");
    const reason = String(body.reason || "").trim();
    if (!reason) throw new DomainError(action === "RESTORE" ? "恢复文件时必须填写原因。" : "作废文件时必须填写原因。");
    if (reason.length > 1_000) throw new DomainError("操作原因不能超过 1000 个字符。");
    await getDatabase().transaction(async (db) => {
      const scope = orderScopeFilter(auth.user, "o");
      const row = await db.prepare(`SELECT f.*,m.system_code,m.applicant_id FROM material_files f
        JOIN order_materials m ON m.id=f.material_id JOIN orders o ON o.id=f.order_id
        WHERE f.id=? AND ${scope.sql} FOR UPDATE`).bind(id, ...scope.values).first();
      if (!row) throw new DomainError("文件记录不存在。", 404);
      const expectedVersion = Number(body.expectedVersion);
      if (Number.isFinite(expectedVersion) && expectedVersion !== Number(row.version)) throw new DomainError("该文件状态已经变化，请刷新后重试。", 409);
      if (action === "VOID" && row.status !== "ACTIVE") throw new DomainError("只有当前有效文件可以作废。");
      if (action === "RESTORE" && row.status === "ACTIVE") throw new DomainError("该文件已经是有效状态。");
      const nextStatus = action === "RESTORE" ? "ACTIVE" : "VOIDED";
      const now = nowIso();
      await db.batch([
        db.prepare("UPDATE material_files SET status=?,superseded_by_id=CASE WHEN ?='ACTIVE' THEN NULL ELSE superseded_by_id END,status_reason=?,status_changed_at=?,status_changed_by=?,version=version+1 WHERE id=?")
          .bind(nextStatus, nextStatus, reason, now, auth.user.id, id),
        db.prepare("UPDATE orders SET updated_at=? WHERE id=?").bind(now, row.order_id),
        ...(row.system_code === "PASSPORT_BIO_PAGE" && row.applicant_id
          ? [db.prepare("UPDATE order_applicants SET mrz_status='NOT_SCANNED',mrz_confirmed_at=NULL,mrz_confirmed_by=NULL WHERE id=? AND order_id=?")
              .bind(row.applicant_id, row.order_id)]
          : []),
      ]);
      await writeAudit(request, auth.user, { action: auditAction, entityType: "MATERIAL_FILE", entityId: id, entityLabel: String(row.stored_name),
        summary: `${action === "RESTORE" ? "恢复" : "作废"}材料文件 ${row.stored_name}`, changes: { before: row, after: { ...row, status: nextStatus, status_reason: reason }, reason } }, db);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { id } = await context.params;
    await writeAuditBestEffort(request, auth.user, { action: auditAction, entityType: "MATERIAL_FILE", entityId: id, result: "FAILURE", summary: `尝试${action === "RESTORE" ? "恢复" : "作废"}材料文件`, changes: { submitted: body } });
    return errorResponse(error);
  }
}

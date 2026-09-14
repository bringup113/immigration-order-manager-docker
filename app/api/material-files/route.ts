import { acquireTransfer, receiveMaterialUpload } from "@/lib/file-transfer";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase, newId, nowIso } from "@/db/database";
import { commitStoredUpload, deleteStoredFile } from "@/lib/file-storage";
import { DomainError } from "@/lib/domain";
import { materialStoredPath, originalFileName } from "@/lib/material-files";
import { jsonError, requireMutationUser } from "@/lib/api-auth";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { orderScopeFilter } from "@/lib/order-access";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("文件上传失败，请稍后重试。", 500);
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request, "materials.write");
  if (auth.response) return auth.response;
  let auditAction = "MATERIAL_FILE_UPLOAD";
  let upload: Awaited<ReturnType<typeof receiveMaterialUpload>> | undefined;
  let release: (() => void) | undefined;
  try {
    release=acquireTransfer("upload",2);
    upload=await receiveMaterialUpload(request);
    const {orderNo="",materialId="",replaceFileId="",reason=""}=upload.fields;
    const file=upload;
    auditAction=replaceFileId ? "MATERIAL_FILE_REPLACE" : auditAction;
    if(!orderNo || !materialId)throw new DomainError("请选择订单材料和需要上传的文件。");
    if(replaceFileId && !reason)throw new DomainError("替换文件时必须填写原因。");
    if(reason.length>1000)throw new DomainError("替换原因不能超过 1000 个字符。");

    const db = getDatabase();
    const scope = orderScopeFilter(auth.user, "o");
    const material = await db.prepare(`SELECT m.id,m.order_id,m.name,m.sequence,m.system_code,m.applicant_id,o.order_no,
      a.name AS applicant_name,a.sequence AS applicant_sequence
      FROM order_materials m JOIN orders o ON o.id=m.order_id
      LEFT JOIN order_applicants a ON a.id=m.applicant_id
      WHERE m.id=? AND o.order_no=? AND ${scope.sql}`).bind(materialId, orderNo, ...scope.values).first();
    if (!material) throw new DomainError("订单材料不存在。", 404);
    const replaced = replaceFileId ? await db.prepare(`SELECT f.* FROM material_files f JOIN orders o ON o.id=f.order_id
      WHERE f.id=? AND f.material_id=? AND o.order_no=? AND ${scope.sql}`).bind(replaceFileId, materialId, orderNo, ...scope.values).first() : null;
    if (replaceFileId && !replaced) throw new DomainError("需要替换的文件不存在。", 404);
    if (replaced && replaced.status !== "ACTIVE") throw new DomainError("只能替换当前有效文件。");

    const {detected,sha256}=upload;
    const id = newId("fil");
    const uploadedAt = nowIso();
    const owner = material.applicant_name === null || material.applicant_name === undefined
      ? null
      : { name: String(material.applicant_name), sequence: Number(material.applicant_sequence) };
    const stored = materialStoredPath(String(material.order_no), owner, String(material.name), Number(material.sequence), detected.extension, uploadedAt, id);
    await commitStoredUpload(upload.path, stored.relativePath);
    try {
      await db.transaction(async (tx) => {
        const current = replaceFileId ? await tx.prepare("SELECT * FROM material_files WHERE id=? AND material_id=? FOR UPDATE").bind(replaceFileId, materialId).first() : null;
        if (replaceFileId && (!current || current.status !== "ACTIVE")) throw new DomainError("该文件状态已经变化，请刷新后重试。", 409);
        const statements = [
          tx.prepare("INSERT INTO material_files (id,order_id,material_id,original_name,stored_name,relative_path,mime_type,size_bytes,sha256,uploaded_at,status,version) VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVE',1)")
            .bind(id, material.order_id, materialId, originalFileName(file.name), stored.storedName, stored.relativePath, detected.mimeType, file.size, sha256, uploadedAt),
          tx.prepare("UPDATE orders SET updated_at=? WHERE id=?").bind(uploadedAt, material.order_id),
        ];
        if (current) statements.push(tx.prepare("UPDATE material_files SET status='SUPERSEDED',superseded_by_id=?,status_reason=?,status_changed_at=?,status_changed_by=?,version=version+1 WHERE id=?")
          .bind(id, reason, uploadedAt, auth.user.id, replaceFileId));
        if(material.system_code === "PASSPORT_BIO_PAGE" && material.applicant_id) statements.push(tx.prepare("UPDATE order_applicants SET mrz_status='NOT_SCANNED',mrz_confirmed_at=NULL,mrz_confirmed_by=NULL WHERE id=? AND order_id=?")
          .bind(material.applicant_id,material.order_id));
        await tx.batch(statements);
        await writeAudit(request, auth.user, { action: auditAction, entityType: "MATERIAL_FILE", entityId: id, entityLabel: stored.storedName,
          summary: current ? `替换材料文件 ${current.stored_name}` : `上传材料文件 ${stored.storedName}`,
          changes: current ? { before: current, after: { id, orderId: material.order_id, materialId, storedName: stored.storedName, mimeType: detected.mimeType, sizeBytes: file.size, sha256, status: "ACTIVE" }, reason } : { orderNo, materialId, mimeType: detected.mimeType, sizeBytes: file.size, sha256 } }, tx);
      });
    } catch (error) {
      await deleteStoredFile(stored.relativePath);
      throw error;
    }
    return NextResponse.json({ id, storedName: stored.storedName }, { status: 201 });
  } catch (error) {
    await writeAuditBestEffort(request, auth.user, { action: auditAction, entityType: "MATERIAL_FILE", result: "FAILURE", summary: auditAction === "MATERIAL_FILE_REPLACE" ? "尝试替换材料文件" : "尝试上传材料文件" });
    return errorResponse(error);
  } finally {
    try { await upload?.cleanup(); } finally { release?.(); }
  }
}

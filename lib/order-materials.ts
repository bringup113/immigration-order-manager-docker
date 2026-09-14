import { newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";
import { DomainError, textValue, type JsonRecord } from "@/lib/domain";
import {
  moveStoredFile,
  quarantineStoredFile,
  type QuarantinedStoredFile,
} from "@/lib/file-storage";
import {
  extensionForMaterialMime,
  materialStoredPath,
} from "@/lib/material-files";
import { dateField } from "@/lib/validation";

type OrderMaterialContext = {
  id: string;
  orderNo: string;
};

export async function saveOrderMaterial(
  db: AppDatabase,
  order: OrderMaterialContext,
  body: JsonRecord,
) {
  const action = textValue(body, "action");
  if (!["addMaterial", "updateMaterial"].includes(action))
    throw new DomainError("材料保存操作不正确。");

  const materialId = textValue(body, "materialId");
  const applicantId = textValue(body, "applicantId");
  const name = textValue(body, "name");
  if (!name) throw new DomainError("请填写材料名称。");
  const expectedDate = dateField(body, "expectedDate", "材料预计日期");
  const targetApplicant = applicantId
    ? await db
        .prepare(
          "SELECT name,sequence FROM order_applicants WHERE id=? AND order_id=?",
        )
        .bind(applicantId, order.id)
        .first()
    : null;
  if (applicantId && !targetApplicant)
    throw new DomainError("申请人不存在。", 404);

  if (action === "updateMaterial") {
    const existing = materialId
      ? await db
          .prepare(
            "SELECT applicant_id,sequence,system_code FROM order_materials WHERE id=? AND order_id=?",
          )
          .bind(materialId, order.id)
          .first()
      : null;
    if (!existing) throw new DomainError("材料不存在。", 404);
    if (existing.system_code)
      throw new DomainError("护照首页是系统固定材料，不能修改。", 409);

    const previousApplicantId = existing.applicant_id
      ? String(existing.applicant_id)
      : "";
    let sequence = Number(existing.sequence);
    if (previousApplicantId !== applicantId) {
      const next = applicantId
        ? await db
            .prepare(
              "SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM order_materials WHERE order_id=? AND applicant_id=?",
            )
            .bind(order.id, applicantId)
            .first()
        : await db
            .prepare(
              "SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM order_materials WHERE order_id=? AND applicant_id IS NULL",
            )
            .bind(order.id)
            .first();
      sequence = Number(next?.value ?? 0);
    }

    const files = await db
      .prepare(
        "SELECT id,relative_path,mime_type,uploaded_at FROM material_files WHERE material_id=?",
      )
      .bind(materialId)
      .all();
    const moved: { from: string; to: string }[] = [];
    const fileUpdates = [];
    try {
      for (const file of files.results) {
        const destination = materialStoredPath(
          order.orderNo,
          targetApplicant
            ? {
                name: String(targetApplicant.name),
                sequence: Number(targetApplicant.sequence),
              }
            : null,
          name,
          sequence,
          extensionForMaterialMime(String(file.mime_type)),
          String(file.uploaded_at),
          String(file.id),
        );
        const sourcePath = String(file.relative_path);
        if (sourcePath !== destination.relativePath) {
          await moveStoredFile(sourcePath, destination.relativePath);
          moved.push({ from: sourcePath, to: destination.relativePath });
        }
        fileUpdates.push(
          db
            .prepare(
              "UPDATE material_files SET stored_name=?,relative_path=? WHERE id=?",
            )
            .bind(destination.storedName, destination.relativePath, file.id),
        );
      }
      const now = nowIso();
      await db.batch([
        db
          .prepare(
            "UPDATE order_materials SET applicant_id=?,name=?,required=?,expected_date=?,sequence=?,notes=? WHERE id=? AND order_id=?",
          )
          .bind(
            applicantId || null,
            name,
            body.required === false ? 0 : 1,
            expectedDate,
            sequence,
            textValue(body, "notes") || null,
            materialId,
            order.id,
          ),
        ...fileUpdates,
        db
          .prepare(
            "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(now, order.id),
      ]);
    } catch (error) {
      for (const file of moved.reverse()) {
        try {
          await moveStoredFile(file.to, file.from);
        } catch {
          // Preserve the original failure while attempting best-effort rollback.
        }
      }
      throw error;
    }
    return;
  }

  const next = applicantId
    ? await db
        .prepare(
          "SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM order_materials WHERE order_id=? AND applicant_id=?",
        )
        .bind(order.id, applicantId)
        .first()
    : await db
        .prepare(
          "SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM order_materials WHERE order_id=? AND applicant_id IS NULL",
        )
        .bind(order.id)
        .first();
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        "INSERT INTO order_materials (id,order_id,template_id,applicant_id,name,required,expected_date,sequence,notes) VALUES (?,?,NULL,?,?,?,?,?,?)",
      )
      .bind(
        newId("mat"),
        order.id,
        applicantId || null,
        name,
        body.required === false ? 0 : 1,
        expectedDate,
        Number(next?.value ?? 0),
        textValue(body, "notes") || null,
      ),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, order.id),
  ]);
}

export async function deleteOrderMaterial(
  db: AppDatabase,
  orderId: string,
  body: JsonRecord,
  quarantinedFiles: QuarantinedStoredFile[],
) {
  const materialId = textValue(body, "materialId");
  const material = materialId
    ? await db
        .prepare(
          "SELECT id,system_code FROM order_materials WHERE id=? AND order_id=?",
        )
        .bind(materialId, orderId)
        .first()
    : null;
  if (!material) throw new DomainError("材料不存在。", 404);
  if (material.system_code)
    throw new DomainError("护照首页是系统固定材料，不能删除。", 409);

  const files = await db
    .prepare("SELECT relative_path FROM material_files WHERE material_id=?")
    .bind(materialId)
    .all();
  for (const file of files.results) {
    const originalPath = String(file.relative_path);
    const quarantinePath = await quarantineStoredFile(originalPath);
    if (quarantinePath) quarantinedFiles.push({ originalPath, quarantinePath });
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare("DELETE FROM order_materials WHERE id=? AND order_id=?")
      .bind(materialId, orderId),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);
}

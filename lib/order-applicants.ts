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

type OrderApplicantContext = {
  id: string;
  orderNo: string;
};

export async function updateOrderApplicant(
  db: AppDatabase,
  order: OrderApplicantContext,
  body: JsonRecord,
  actorUserId: string,
) {
  const applicantId = textValue(body, "applicantId");
  const name = textValue(body, "name");
  const nationality = textValue(body, "nationality");
  const passportNo = textValue(body, "passportNo")
    .toUpperCase()
    .replace(/\s+/g, "");
  const relationship = textValue(body, "relationship");
  if (!name) throw new DomainError("请填写申请人姓名。");
  if (!passportNo) throw new DomainError("请填写申请人护照号码。");
  if (!nationality) throw new DomainError("请填写申请人国籍。");

  const applicant = applicantId
    ? await db
        .prepare("SELECT * FROM order_applicants WHERE id=? AND order_id=?")
        .bind(applicantId, order.id)
        .first()
    : null;
  if (!applicant) throw new DomainError("申请人不存在。", 404);
  const duplicate = await db
    .prepare(
      "SELECT id FROM order_applicants WHERE order_id=? AND id<>? AND upper(replace(passport_no,' ',''))=?",
    )
    .bind(order.id, applicantId, passportNo)
    .first();
  if (duplicate)
    throw new DomainError("同一订单内不能重复使用相同的护照号码。");

  const files = await db
    .prepare(
      `SELECT f.id,f.relative_path,f.mime_type,f.uploaded_at,m.name AS material_name,m.sequence AS material_sequence
       FROM material_files f JOIN order_materials m ON m.id=f.material_id WHERE m.applicant_id=?`,
    )
    .bind(applicantId)
    .all();
  const moved: { from: string; to: string }[] = [];
  const fileUpdates = [];
  try {
    for (const file of files.results) {
      const destination = materialStoredPath(
        order.orderNo,
        { name, sequence: Number(applicant.sequence) },
        String(file.material_name),
        Number(file.material_sequence),
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

    const sex = textValue(body, "sex");
    if (sex && !["M", "F", "X"].includes(sex))
      throw new DomainError("申请人性别格式不正确。");
    const birthDate = dateField(body, "birthDate", "出生日期", true);
    const passportExpiry = dateField(
      body,
      "passportExpiry",
      "护照有效期",
      true,
    );
    const identityValues = [
      [String(applicant.passport_no || ""), passportNo],
      [String(applicant.surname || ""), textValue(body, "surname")],
      [String(applicant.given_names || ""), textValue(body, "givenNames")],
      [String(applicant.nationality || ""), nationality],
      [String(applicant.birth_date || "").slice(0, 10), birthDate],
      [String(applicant.sex || ""), sex],
      [String(applicant.passport_expiry || "").slice(0, 10), passportExpiry],
      [
        String(applicant.issuing_country || ""),
        textValue(body, "issuingCountry"),
      ],
      [String(applicant.document_code || ""), textValue(body, "documentCode")],
      [
        String(applicant.personal_number || ""),
        textValue(body, "personalNumber"),
      ],
    ];
    const identityChanged = identityValues.some(
      ([before, after]) => before !== after,
    );
    const now = nowIso();
    await db.batch([
      db
        .prepare(
          `UPDATE order_applicants SET name=?,nationality=?,passport_no=?,relationship=?,surname=?,given_names=?,birth_date=?,sex=?,passport_expiry=?,issuing_country=?,document_code=?,personal_number=?,
           mrz_status=?,mrz_confirmed_at=?,mrz_confirmed_by=? WHERE id=? AND order_id=?`,
        )
        .bind(
          name,
          nationality,
          passportNo,
          applicant.applicant_type === "MAIN" ? null : relationship || null,
          textValue(body, "surname") || null,
          textValue(body, "givenNames") || null,
          birthDate,
          sex || null,
          passportExpiry,
          textValue(body, "issuingCountry") || null,
          textValue(body, "documentCode") || null,
          textValue(body, "personalNumber") || null,
          identityChanged ? "MANUALLY_CONFIRMED" : applicant.mrz_status,
          identityChanged ? now : applicant.mrz_confirmed_at,
          identityChanged ? actorUserId : applicant.mrz_confirmed_by,
          applicantId,
          order.id,
        ),
      ...fileUpdates,
      db
        .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
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
}

export async function addDependentApplicant(
  db: AppDatabase,
  orderId: string,
  body: JsonRecord,
) {
  const name = textValue(body, "name");
  const nationality = textValue(body, "nationality");
  const passportNo = textValue(body, "passportNo")
    .toUpperCase()
    .replace(/\s+/g, "");
  const relationship = textValue(body, "relationship");
  if (!name || !passportNo || !nationality)
    throw new DomainError("姓名、护照号码和国籍为必填项。");

  const duplicate = await db
    .prepare(
      "SELECT id FROM order_applicants WHERE order_id=? AND upper(replace(passport_no,' ',''))=?",
    )
    .bind(orderId, passportNo)
    .first();
  if (duplicate)
    throw new DomainError("同一订单内不能重复使用相同的护照号码。");

  const next = await db
    .prepare(
      "SELECT COALESCE(MAX(sequence),-1)+1 AS value FROM order_applicants WHERE order_id=?",
    )
    .bind(orderId)
    .first();
  const applicantId = newId("apl");
  const passportMaterialId = newId("mat");
  const sex = textValue(body, "sex");
  if (sex && !["M", "F", "X"].includes(sex))
    throw new DomainError("申请人性别格式不正确。");
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO order_applicants
          (id,order_id,applicant_type,relationship,name,nationality,passport_no,sequence,surname,given_names,birth_date,sex,passport_expiry,issuing_country,document_code,personal_number)
          VALUES (?,?,'DEPENDENT',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        applicantId,
        orderId,
        relationship || "其他",
        name,
        nationality,
        passportNo,
        Number(next?.value || 1),
        textValue(body, "surname") || null,
        textValue(body, "givenNames") || null,
        dateField(body, "birthDate", "出生日期", true),
        sex || null,
        dateField(body, "passportExpiry", "护照有效期", true),
        textValue(body, "issuingCountry") || null,
        textValue(body, "documentCode") || null,
        textValue(body, "personalNumber") || null,
      ),
    db
      .prepare(
        `INSERT INTO order_materials
          (id,order_id,template_id,applicant_id,name,required,expected_date,sequence,notes,system_code)
          VALUES (?,?,NULL,?,'护照首页',1,NULL,-100,'每位申请人的系统固定身份材料','PASSPORT_BIO_PAGE')`,
      )
      .bind(passportMaterialId, orderId, applicantId),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);
  return { applicantId, passportMaterialId };
}

export async function deleteOrderApplicant(
  db: AppDatabase,
  orderId: string,
  body: JsonRecord,
  quarantinedFiles: QuarantinedStoredFile[],
) {
  const applicantId = textValue(body, "applicantId");
  const applicant = applicantId
    ? await db
        .prepare(
          "SELECT id,name,applicant_type FROM order_applicants WHERE id=? AND order_id=?",
        )
        .bind(applicantId, orderId)
        .first()
    : null;
  if (!applicant) throw new DomainError("申请人不存在。", 404);
  if (applicant.applicant_type === "MAIN")
    throw new DomainError("主申请人不能删除，只能修改资料。");

  const files = await db
    .prepare(
      "SELECT f.relative_path FROM material_files f JOIN order_materials m ON m.id=f.material_id WHERE m.applicant_id=?",
    )
    .bind(applicantId)
    .all();
  for (const file of files.results) {
    const originalPath = String(file.relative_path);
    const quarantinePath = await quarantineStoredFile(originalPath);
    if (quarantinePath) quarantinedFiles.push({ originalPath, quarantinePath });
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare("DELETE FROM order_applicants WHERE id=? AND order_id=?")
      .bind(applicantId, orderId),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);
}

import { newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";
import { DomainError, textValue, type JsonRecord } from "@/lib/domain";
import { dateField, FIELD_LIMITS, validateTextFields } from "@/lib/validation";
import { parse as parseMrz } from "mrz";

export async function confirmApplicantMrz(
  db: AppDatabase,
  orderId: string,
  body: JsonRecord,
  actorUserId: string,
) {
  const applicantId = textValue(body, "applicantId");
  const materialFileId = textValue(body, "materialFileId");
  const rawMrz = textValue(body, "rawMrz")
    .toUpperCase()
    .replace(/\r/g, "")
    .trim();
  if (!applicantId || !materialFileId || !rawMrz || rawMrz.length > 400)
    throw new DomainError("MRZ 识别结果不完整。");

  const applicant = await db
    .prepare("SELECT id FROM order_applicants WHERE id=? AND order_id=?")
    .bind(applicantId, orderId)
    .first();
  if (!applicant) throw new DomainError("申请人不存在。", 404);
  const file = await db
    .prepare(
      `SELECT f.id FROM material_files f JOIN order_materials m ON m.id=f.material_id
       WHERE f.id=? AND f.order_id=? AND f.status='ACTIVE' AND m.applicant_id=? AND m.system_code='PASSPORT_BIO_PAGE'`,
    )
    .bind(materialFileId, orderId, applicantId)
    .first();
  if (!file)
    throw new DomainError("请选择该申请人当前有效的护照首页文件。", 404);

  let parsed: ReturnType<typeof parseMrz>;
  try {
    parsed = parseMrz(
      rawMrz
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      { autocorrect: true },
    );
  } catch {
    throw new DomainError("MRZ 文本格式无法解析，请重新识别或人工填写资料。");
  }

  const submitted = (
    body.fields &&
    typeof body.fields === "object" &&
    !Array.isArray(body.fields)
      ? body.fields
      : {}
  ) as JsonRecord;
  validateTextFields(submitted, [
    {
      key: "name",
      label: "系统显示姓名",
      max: FIELD_LIMITS.name,
      required: true,
    },
    { key: "surname", label: "护照姓", max: FIELD_LIMITS.name },
    { key: "givenNames", label: "护照名", max: FIELD_LIMITS.name },
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

  const name = textValue(submitted, "name");
  const passportNo = textValue(submitted, "passportNo")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!name || !passportNo)
    throw new DomainError("请确认系统显示姓名和护照号码。");
  const duplicate = await db
    .prepare(
      "SELECT id FROM order_applicants WHERE order_id=? AND id<>? AND upper(replace(passport_no,' ',''))=?",
    )
    .bind(orderId, applicantId, passportNo)
    .first();
  if (duplicate)
    throw new DomainError("同一订单内不能重复使用相同的护照号码。");
  const sex = textValue(submitted, "sex");
  if (sex && !["M", "F", "X"].includes(sex))
    throw new DomainError("申请人性别格式不正确。");

  const checksumDetails = parsed.details.filter((detail) =>
    String(detail.field || "")
      .toLowerCase()
      .includes("checkdigit"),
  );
  const checksums = Object.fromEntries(
    checksumDetails.map((detail) => [String(detail.field), detail.valid]),
  );
  const checksumValid =
    checksumDetails.length > 0 &&
    checksumDetails.every((detail) => detail.valid);
  const overallStatus = checksumValid ? "VALID" : "MANUALLY_CONFIRMED";
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE order_applicants SET name=?,surname=?,given_names=?,nationality=?,passport_no=?,birth_date=?,sex=?,passport_expiry=?,issuing_country=?,document_code=?,personal_number=?,mrz_status=?,mrz_confirmed_at=?,mrz_confirmed_by=? WHERE id=? AND order_id=?`,
      )
      .bind(
        name,
        textValue(submitted, "surname") || null,
        textValue(submitted, "givenNames") || null,
        textValue(submitted, "nationality") || null,
        passportNo,
        dateField(submitted, "birthDate", "出生日期", true),
        sex || null,
        dateField(submitted, "passportExpiry", "护照有效期", true),
        textValue(submitted, "issuingCountry") || null,
        textValue(submitted, "documentCode") || null,
        textValue(submitted, "personalNumber") ||
          String(parsed.fields.personalNumber || "") ||
          null,
        overallStatus,
        now,
        actorUserId,
        applicantId,
        orderId,
      ),
    db
      .prepare(
        `INSERT INTO applicant_mrz_records
         (id,order_id,applicant_id,material_file_id,raw_mrz,parsed_json,checksums_json,overall_status,created_at,confirmed_by,confirmed_at)
         VALUES (?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?)
         ON CONFLICT(material_file_id) DO UPDATE SET raw_mrz=excluded.raw_mrz,parsed_json=excluded.parsed_json,checksums_json=excluded.checksums_json,overall_status=excluded.overall_status,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at`,
      )
      .bind(
        newId("mrz"),
        orderId,
        applicantId,
        materialFileId,
        rawMrz,
        JSON.stringify({
          format: parsed.format,
          fields: parsed.fields,
          details: parsed.details,
        }),
        JSON.stringify(checksums),
        overallStatus,
        now,
        actorUserId,
        now,
      ),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);

  return { valid: checksumValid, checksums };
}

import { DomainError } from "@/lib/domain";

export const MAX_MATERIAL_FILE_SIZE = 20 * 1024 * 1024;
export const MATERIAL_FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

export type DetectedMaterialFile = {
  extension: "pdf" | "jpg" | "png" | "webp";
  mimeType: string;
};

export function extensionForMaterialMime(
  mimeType: string,
): DetectedMaterialFile["extension"] {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  throw new DomainError("文件类型不正确。");
}

export function detectMaterialFile(data: Uint8Array): DetectedMaterialFile {
  if (data.length >= 5 && String.fromCharCode(...data.slice(0, 5)) === "%PDF-")
    return { extension: "pdf", mimeType: "application/pdf" };
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return { extension: "jpg", mimeType: "image/jpeg" };
  if (
    data.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => data[index] === value,
    )
  )
    return { extension: "png", mimeType: "image/png" };
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.slice(8, 12)) === "WEBP"
  )
    return { extension: "webp", mimeType: "image/webp" };
  throw new DomainError("只接受 PDF、JPG/JPEG、PNG 或 WEBP 文件。");
}

export function safeFileSegment(value: string, fallback: string, maximum = 80) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    .slice(0, maximum);
  return normalized || fallback;
}

export type MaterialFileOwner = { name: string; sequence: number } | null;

export function materialStoredPath(
  orderNo: string,
  owner: MaterialFileOwner,
  materialName: string,
  sequence: number,
  extension: DetectedMaterialFile["extension"],
  uploadedAt: string,
  id: string,
) {
  const safeOrder = safeFileSegment(orderNo, "order");
  const safeMaterial = safeFileSegment(materialName, "material");
  const materialLabel = String(sequence + 1).padStart(2, "0");
  const timestamp = uploadedAt.replace(/[-:TZ.]/g, "").slice(0, 14);
  const ownerLabel = owner
    ? `${String(owner.sequence + 1).padStart(2, "0")}-${safeFileSegment(owner.name, "applicant")}`
    : "common";
  const storedOwner = owner
    ? safeFileSegment(owner.name, "applicant")
    : "common";
  const storedName = `${safeOrder}_${storedOwner}_${materialLabel}_${safeMaterial}_${timestamp}_${safeFileSegment(id.slice(-8), "file", 8)}.${extension}`;
  const ownerPath = owner ? `applicants/${ownerLabel}` : "common";
  return {
    storedName,
    relativePath: `orders/${safeOrder}/${ownerPath}/${materialLabel}-${safeMaterial}/${storedName}`,
  };
}

export function originalFileName(value: string) {
  const basename = value.split(/[\\/]/).pop() || "未命名文件";
  return (
    basename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "未命名文件"
  );
}

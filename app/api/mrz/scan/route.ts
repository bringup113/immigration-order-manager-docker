import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireMutationUser } from "@/lib/api-auth";
import { writeAuditBestEffort } from "@/lib/audit";
import { DomainError } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("MRZ 识别服务暂时不可用，请稍后重试。", 503);
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request, "applicants.mrz");
  if (auth.response) return auth.response;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    if (!(entry instanceof File)) throw new DomainError("请选择护照首页图片。", 400);
    const file = entry;
    const type = file.type.toLowerCase();
    const extension = file.name.toLowerCase();
    if (!ALLOWED_TYPES.has(type) && !/\.(jpe?g|png|webp)$/.test(extension)) {
      throw new DomainError("MRZ 服务目前只接受 JPG、JPEG、PNG 或 WEBP 图片。", 415);
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new DomainError("护照图片不能超过 20 MB。", 413);
    }

    const sidecarUrl = (process.env.MRZ_SIDECAR_URL || "http://mrzscanner_poc:8080").replace(/\/$/, "");
    const body = Buffer.from(await file.arrayBuffer());
    let response: Response;
    try {
      response = await fetch(`${sidecarUrl}/scan?include_raw=1`, {
        method: "POST",
        headers: {
          "Content-Type": type || "application/octet-stream",
          "Content-Length": String(body.byteLength),
          "X-Filename": file.name,
        },
        body,
        signal: AbortSignal.timeout(70_000),
      });
    } catch {
      throw new DomainError("MRZ 识别服务暂时不可用，请确认 sidecar 已启动。", 503);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (!response.ok || payload.ok !== true) {
      const status = response.status === 429 ? 429 : response.status === 503 ? 503 : 422;
      const message = typeof payload.error === "string" ? payload.error : "没有识别到完整 MRZ。";
      throw new DomainError(message, status);
    }

    await writeAuditBestEffort(request, auth.user!, {
      action: "APPLICANT_MRZ_SCAN",
      entityType: "APPLICANT_MRZ",
      result: "SUCCESS",
      summary: "调用 MRZ 识别服务",
      changes: { mimeType: type || null, sizeBytes: file.size, detected: payload.mrz_detected === true },
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    await writeAuditBestEffort(request, auth.user!, {
      action: "APPLICANT_MRZ_SCAN",
      entityType: "APPLICANT_MRZ",
      result: "FAILURE",
      summary: error instanceof DomainError ? error.message : "调用 MRZ 识别服务失败",
    });
    return errorResponse(error);
  }
}

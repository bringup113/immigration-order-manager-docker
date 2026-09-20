import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireMutationUser } from "@/lib/api-auth";
import { writeAuditBestEffort } from "@/lib/audit";
import { createReadStream } from "node:fs";
import { acquireTransfer, receiveMaterialUpload } from "@/lib/file-transfer";
import { DomainError } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("MRZ 识别服务暂时不可用，请稍后重试。", 503);
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request, "applicants.mrz");
  if (auth.response) return auth.response;
  let release: (() => void) | undefined;
  let upload: Awaited<ReturnType<typeof receiveMaterialUpload>> | undefined;
  let stream: ReturnType<typeof createReadStream> | undefined;
  try {
    release = acquireTransfer("mrz", 2);
    upload = await receiveMaterialUpload(request, []);
    if (upload.detected.extension === "pdf") throw new DomainError("MRZ 服务只接受护照首页图片。", 415);
    const type = upload.detected.mimeType;
    const sidecarUrl = (process.env.MRZ_SIDECAR_URL || "http://mrzscanner_poc:8080").replace(/\/$/, "");
    stream = createReadStream(upload.path, {highWaterMark: 64 * 1024});
    let response: Response;
    try {
      response = await fetch(`${sidecarUrl}/scan?include_raw=1`, {
        method: "POST",
        headers: {
          "Content-Type": type || "application/octet-stream",
          "Content-Length": String(upload.size),
          "X-Filename": `passport.${upload.detected.extension}`,
        },
        body: stream as unknown as BodyInit,
        duplex: "half",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(70_000)]),
      } as RequestInit & {duplex: "half"});
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
      changes: { mimeType: type || null, sizeBytes: upload.size, detected: payload.mrz_detected === true },
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
  } finally {
    stream?.destroy();
    try { await upload?.cleanup(); } finally { release?.(); }
  }
}

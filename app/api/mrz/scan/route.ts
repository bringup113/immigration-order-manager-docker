import { NextRequest } from "next/server";
import { jsonError, requireMutationUser } from "@/lib/api-auth";
import { writeAuditBestEffort } from "@/lib/audit";
import { createReadStream } from "node:fs";
import { acquireTransfer, receiveMaterialUpload } from "@/lib/file-transfer";
import { DomainError } from "@/lib/domain";
import { getDatabase } from "@/db/database";
import { openStoredFile } from "@/lib/file-storage";
import { orderScopeFilter } from "@/lib/order-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("MRZ 识别服务暂时不可用，请稍后重试。", 503);
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const auth = await requireMutationUser(request, "applicants.mrz");
  if (auth.response) return auth.response;
  let release: (() => void) | undefined;
  let upload: Awaited<ReturnType<typeof receiveMaterialUpload>> | undefined;
  let stream: ReturnType<typeof createReadStream> | undefined;
  let storedFile: Awaited<ReturnType<typeof openStoredFile>> | undefined;
  let source: "upload" | "stored" = "upload";
  let finalized = false;
  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    stream?.destroy();
    try {
      await storedFile?.close().catch(() => undefined);
      await upload?.cleanup();
    } finally {
      release?.();
    }
  };
  try {
    release = acquireTransfer("mrz", 2);
    let type = "";
    let size = 0;
    let extension = "";
    if ((request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
      source = "stored";
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const materialFileId = typeof body.materialFileId === "string" ? body.materialFileId.trim() : "";
      if (!materialFileId) throw new DomainError("请选择需要识别的护照文件。");
      const db = getDatabase();
      const scope = orderScopeFilter(auth.user, "o");
      const row = await db.prepare(`SELECT f.relative_path,f.mime_type,f.size_bytes,m.system_code
        FROM material_files f
        JOIN order_materials m ON m.id=f.material_id
        JOIN orders o ON o.id=f.order_id
        WHERE f.id=? AND f.status='ACTIVE' AND ${scope.sql}`)
        .bind(materialFileId, ...scope.values).first();
      if (!row || row.system_code !== "PASSPORT_BIO_PAGE")
        throw new DomainError("护照首页文件不存在或不可识别。", 404);
      type = String(row.mime_type || "");
      size = Number(row.size_bytes || 0);
      if (!Number.isSafeInteger(size) || size <= 0) throw new DomainError("护照文件大小不正确。", 422);
      extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/jpeg" ? "jpg" : "";
      if (!extension) throw new DomainError("已保存的护照文件不是可识别图片，请重新上传。", 415);
      storedFile = await openStoredFile(String(row.relative_path));
      stream = storedFile.createReadStream({ highWaterMark: 64 * 1024 });
    } else {
      upload = await receiveMaterialUpload(request, []);
      if (upload.detected.extension === "pdf") throw new DomainError("MRZ 服务只接受护照首页图片。", 415);
      type = upload.detected.mimeType;
      size = upload.size;
      extension = upload.detected.extension;
      stream = createReadStream(upload.path, { highWaterMark: 64 * 1024 });
    }
    const receivedAt = performance.now();
    const sidecarUrl = (process.env.MRZ_SIDECAR_URL || "http://mrzscanner_poc:8080").replace(/\/$/, "");
    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        void (async () => {
          let payload: Record<string, unknown> = {};
          const sidecarStartedAt = performance.now();
          try {
            send({ type: "stage", stage: "validating" });
            send({ type: "stage", stage: "forwarding" });
            const created = await fetch(`${sidecarUrl}/jobs?include_raw=1`, {
              method: "POST",
              headers: {
                "Content-Type": type || "application/octet-stream",
                "Content-Length": String(size),
                "X-Filename": `passport.${extension}`,
              },
              body: stream as unknown as BodyInit,
              duplex: "half",
              signal: AbortSignal.timeout(15_000),
            } as RequestInit & {duplex: "half"});
            const createdPayload = await created.json().catch(() => ({})) as Record<string, unknown>;
            if (!created.ok || typeof createdPayload.job_id !== "string") {
              const message = typeof createdPayload.error === "string"
                ? createdPayload.error
                : "MRZ 识别服务暂时不可用，请稍后重试。";
              throw new DomainError(message, created.status === 429 ? 429 : 503);
            }
            const jobId = createdPayload.job_id;
            let previousStage = "";
            const deadline = Date.now() + 65_000;
            while (Date.now() < deadline) {
              const statusResponse = await fetch(`${sidecarUrl}/jobs/${encodeURIComponent(jobId)}`, {
                cache: "no-store",
                signal: AbortSignal.timeout(3_000),
              });
              const statusPayload = await statusResponse.json().catch(() => ({})) as Record<string, unknown>;
              if (!statusResponse.ok) throw new DomainError("MRZ 识别任务状态读取失败。", 503);
              const status = String(statusPayload.status || "");
              if (status === "queued" && previousStage !== "queued") {
                const queue = statusPayload.queue as Record<string, unknown> | undefined;
                send({ type: "stage", stage: "queued", waiting: Number(queue?.waiting || 0) });
                previousStage = "queued";
              }
              if (status === "recognizing" && previousStage !== "recognizing") {
                send({ type: "stage", stage: "recognizing" });
                previousStage = "recognizing";
              }
              if (status === "completed") {
                payload = statusPayload.result && typeof statusPayload.result === "object"
                  ? statusPayload.result as Record<string, unknown>
                  : {};
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 120));
            }
            if (!Object.keys(payload).length) throw new DomainError("MRZ 识别超时，请稍后重试。", 504);
            if (payload.ok !== true) {
              throw new DomainError(typeof payload.error === "string" ? payload.error : "没有识别到完整 MRZ。", 422);
            }
            await writeAuditBestEffort(request, auth.user!, {
              action: "APPLICANT_MRZ_SCAN",
              entityType: "APPLICANT_MRZ",
              result: "SUCCESS",
              summary: "调用 MRZ 识别服务",
              changes: { mimeType: type || null, sizeBytes: size, detected: payload.mrz_detected === true },
            });
            const sidecarEndedAt = performance.now();
            console.info(JSON.stringify({
              event: "mrz_scan_timing",
              source,
              sizeBytes: size,
              receiveSeconds: Number(((receivedAt - startedAt) / 1000).toFixed(3)),
              sidecarSeconds: Number(((sidecarEndedAt - sidecarStartedAt) / 1000).toFixed(3)),
              totalSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)),
              queueSeconds: typeof payload.queue_wait_ms === "number" ? Number((payload.queue_wait_ms / 1000).toFixed(3)) : null,
              processingSeconds: typeof payload.processing_ms === "number" ? Number((payload.processing_ms / 1000).toFixed(3)) : null,
            }));
            send({ type: "result", payload });
          } catch (error) {
            await writeAuditBestEffort(request, auth.user!, {
              action: "APPLICANT_MRZ_SCAN",
              entityType: "APPLICANT_MRZ",
              result: "FAILURE",
              summary: error instanceof DomainError ? error.message : "调用 MRZ 识别服务失败",
            });
            send({
              type: "error",
              error: error instanceof DomainError ? error.message : "MRZ 识别服务暂时不可用，请稍后重试。",
            });
          } finally {
            await finalize();
            controller.close();
          }
        })();
      },
      async cancel() { await finalize(); },
    });
    return new Response(responseStream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    await writeAuditBestEffort(request, auth.user!, {
      action: "APPLICANT_MRZ_SCAN",
      entityType: "APPLICANT_MRZ",
      result: "FAILURE",
      summary: error instanceof DomainError ? error.message : "调用 MRZ 识别服务失败",
    });
    await finalize();
    return errorResponse(error);
  }
}

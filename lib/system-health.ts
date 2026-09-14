import { statfs, readdir, stat } from "node:fs/promises";
import { getDatabase } from "@/db/database";

type MrzReport = {
  status: "healthy" | "starting" | "unavailable";
  checkedAt: string;
  mode: string | null;
  startupError: string | null;
  queue: {
    waiting: number;
    waitingBytes: number;
    active: boolean;
    maxWaiting: number;
    maxBytes: number;
  } | null;
  metrics: {
    accepted: number;
    completed: number;
    succeeded: number;
    failed: number;
    rejected: number;
    timedOut: number;
    successRate: number | null;
    lastProcessingMs: number | null;
    p50ProcessingMs: number | null;
    p95ProcessingMs: number | null;
  } | null;
  peakRssMiB: number | null;
};

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    Math.round(
      sorted[
        Math.min(
          sorted.length - 1,
          Math.ceil(sorted.length * percentileValue) - 1,
        )
      ] * 100,
    ) / 100
  );
}

async function readMrzHealth(): Promise<MrzReport> {
  const checkedAt = new Date().toISOString();
  const unavailable = (startupError: string | null = null): MrzReport => ({
    status: startupError ? "unavailable" : "starting",
    checkedAt,
    mode: "two_stage/cpu",
    startupError,
    queue: null,
    metrics: null,
    peakRssMiB: null,
  });
  const base = (
    process.env.MRZ_SIDECAR_URL || "http://mrzscanner_poc:8080"
  ).replace(/\/$/, "");
  try {
    const healthResponse = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1200),
    });
    const health = (await healthResponse.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const startupError =
      typeof health.startup_error === "string"
        ? health.startup_error.slice(0, 300)
        : null;
    if (!healthResponse.ok || health.ready !== true)
      return unavailable(startupError);
    let metricsPayload: Record<string, unknown> = {};
    try {
      const metricsResponse = await fetch(`${base}/metrics`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1200),
      });
      if (metricsResponse.ok)
        metricsPayload = (await metricsResponse.json()) as Record<
          string,
          unknown
        >;
    } catch {
      /* 健康状态仍然有效，指标稍后再读 */
    }
    const rawQueue = metricsPayload.queue as
      | Record<string, unknown>
      | undefined;
    const rawMetrics = metricsPayload.metrics as
      | Record<string, unknown>
      | undefined;
    const processing = Array.isArray(rawMetrics?.processing_ms)
      ? rawMetrics.processing_ms
          .map(numberValue)
          .filter((value): value is number => value !== null)
      : [];
    const accepted = numberValue(rawMetrics?.accepted) ?? 0;
    const succeeded = numberValue(rawMetrics?.succeeded) ?? 0;
    const metrics = rawMetrics
      ? {
          accepted,
          completed: numberValue(rawMetrics.completed) ?? 0,
          succeeded,
          failed: numberValue(rawMetrics.failed) ?? 0,
          rejected: numberValue(rawMetrics.rejected) ?? 0,
          timedOut: numberValue(rawMetrics.timed_out) ?? 0,
          successRate:
            accepted > 0
              ? Math.round((succeeded / accepted) * 1000) / 10
              : null,
          lastProcessingMs: processing.length
            ? processing[processing.length - 1]
            : null,
          p50ProcessingMs: percentile(processing, 0.5),
          p95ProcessingMs: percentile(processing, 0.95),
        }
      : null;
    return {
      status: "healthy",
      checkedAt,
      mode: typeof health.mode === "string" ? health.mode : "two_stage/cpu",
      startupError: null,
      queue: rawQueue
        ? {
            waiting: numberValue(rawQueue.waiting) ?? 0,
            waitingBytes: numberValue(rawQueue.waiting_bytes) ?? 0,
            active: rawQueue.active === true,
            maxWaiting: numberValue(rawQueue.max_waiting) ?? 0,
            maxBytes: numberValue(rawQueue.max_bytes) ?? 0,
          }
        : null,
      metrics,
      peakRssMiB: numberValue(metricsPayload.peak_rss_mb),
    };
  } catch {
    return { ...unavailable("无法连接到 MRZ sidecar"), status: "unavailable" };
  }
}

export async function systemHealth() {
  const mrzPromise = readMrzHealth();
  const queue = await getDatabase()
    .prepare(
      `SELECT count(*)::int AS pending,
    count(*) FILTER (WHERE attempts>0)::int AS retrying,
    COALESCE(EXTRACT(EPOCH FROM now()-min(requested_at)),0)::float AS oldest_seconds FROM search_jobs`,
    )
    .first<{ pending: number; retrying: number; oldest_seconds: number }>();
  const disk = await statfs(process.env.UPLOAD_ROOT || "/app/data").catch(
    () => null,
  );
  const backupRoot = process.env.BACKUP_STATUS_ROOT;
  const backup = backupRoot
    ? await (async () => {
        const names = (await readdir(backupRoot)).filter((name) =>
          /^migra-.*\.dump$/.test(name),
        );
        const dates = await Promise.all(
          names.map(
            async (name) => (await stat(`${backupRoot}/${name}`)).mtimeMs,
          ),
        );
        const latest = dates.length ? Math.max(...dates) : null;
        return {
          latestAt: latest ? new Date(latest).toISOString() : null,
          ageHours: latest ? (Date.now() - latest) / 3600000 : null,
        };
      })().catch(() => null)
    : null;
  const warnings: string[] = [];
  if (backupRoot && (!backup?.latestAt || (backup.ageHours ?? 0) > 36))
    warnings.push("数据库备份缺失、无法读取或超过36小时未更新，请检查备份日志");
  if (queue && queue.oldest_seconds > 120)
    warnings.push("搜索索引等待超过两分钟");
  if (queue?.retrying) warnings.push("搜索索引有失败重试任务");
  if (disk && disk.bavail / disk.blocks < 0.1)
    warnings.push("附件所在磁盘剩余空间不足10%");
  const mrz = await mrzPromise;
  if (mrz.status === "starting")
    warnings.push("MRZ 识别服务正在启动，模型加载完成后即可使用");
  if (mrz.status === "unavailable")
    warnings.push("MRZ 识别服务不可用，请检查 sidecar 容器状态和日志");
  return {
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memoryMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    queue,
    mrz,
    backup,
    disk: disk
      ? {
          freeGiB: +((disk.bavail * disk.bsize) / 1024 ** 3).toFixed(2),
          freePercent: +((disk.bavail / disk.blocks) * 100).toFixed(1),
        }
      : null,
    warnings,
  };
}
export type SystemHealth = Awaited<ReturnType<typeof systemHealth>>;

let started = false;
export function startHealthMonitor() {
  if (started) return;
  started = true;
  const timer = setInterval(() => {
    void systemHealth()
      .then((report) => {
        if (report.warnings.length)
          console.warn(
            JSON.stringify({ event: "system_health_warning", ...report }),
          );
      })
      .catch(() =>
        console.error(JSON.stringify({ event: "system_health_check_failed" })),
      );
  }, 60000);
  timer.unref();
}

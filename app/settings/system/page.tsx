"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { SystemHealth } from "@/lib/system-health";
function formatDurationMs(value: number | null) {
  return value === null ? "—" : `${(value / 1000).toFixed(2)} 秒`;
}
export default function SystemPage() {
  const [data, setData] = useState<SystemHealth | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/system", { cache: "no-store" });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/system", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw Error(result.error);
        return result;
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, 30000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);
  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">运行状态</h1>
          {data && (
            <p className="mt-1 text-sm text-slate-500">
              检查时间：{new Date(data.checkedAt).toLocaleString("zh-CN")}
            </p>
          )}
        </div>
        <button
          disabled={loading}
          onClick={() => void refresh()}
          className="rounded-lg border bg-white px-4 py-2"
        >
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border bg-white p-5">
              <h2 className="font-semibold">主应用</h2>
              <div className="mt-3 space-y-2 text-sm">
                <p>应用内存：{data.memoryMiB} MB（当前进程）</p>
                <p>连续运行：{Math.floor(data.uptimeSeconds / 60)} 分钟</p>
                <p>
                  待同步索引：{data.queue?.pending ?? "未知"}，失败重试：
                  {data.queue?.retrying ?? "未知"}，最长等待：
                  {Math.round(data.queue?.oldest_seconds ?? 0)} 秒
                </p>
              </div>
            </section>
            <section className="rounded-xl border bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">MRZ 识别服务</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${data.mrz.status === "healthy" ? "bg-emerald-100 text-emerald-800" : data.mrz.status === "starting" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}
                >
                  {data.mrz.status === "healthy"
                    ? "正常"
                    : data.mrz.status === "starting"
                      ? "启动中"
                      : "不可用"}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <p>模式：{data.mrz.mode || "—"}</p>
                <p>
                  队列：
                  {data.mrz.queue
                    ? `${data.mrz.queue.active ? "处理中" : "空闲"}，等待 ${data.mrz.queue.waiting}/${data.mrz.queue.maxWaiting}`
                    : "暂不可用"}
                </p>
                {data.mrz.metrics && (
                  <>
                    <p>
                      识别：成功 {data.mrz.metrics.succeeded}/
                      {data.mrz.metrics.accepted}（成功率{" "}
                      {data.mrz.metrics.successRate === null
                        ? "—"
                        : `${data.mrz.metrics.successRate}%`}
                      ），失败 {data.mrz.metrics.failed}，拒绝{" "}
                      {data.mrz.metrics.rejected}，超时{" "}
                      {data.mrz.metrics.timedOut}
                    </p>
                    <p>
                      耗时：最近{" "}
                      {formatDurationMs(data.mrz.metrics.lastProcessingMs)}；P50{" "}
                      {formatDurationMs(data.mrz.metrics.p50ProcessingMs)}；P95{" "}
                      {formatDurationMs(data.mrz.metrics.p95ProcessingMs)}
                    </p>
                  </>
                )}
                {data.mrz.peakRssMiB !== null && (
                  <p>内存峰值：{data.mrz.peakRssMiB} MiB</p>
                )}
                {data.mrz.startupError && (
                  <p className="break-words text-rose-700">
                    原因：{data.mrz.startupError}
                  </p>
                )}
              </div>
            </section>
          </div>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">数据库与文件</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p>
                最近数据库备份：
                {data.backup?.latestAt
                  ? new Date(data.backup.latestAt).toLocaleString("zh-CN")
                  : "暂不可用"}
                （文件时间，不代表已通过恢复验证）
              </p>
              <p>
                附件磁盘可用空间：
                {data.disk
                  ? `${data.disk.freeGiB} GB（${data.disk.freePercent}%）`
                  : "暂不可用"}
              </p>
            </div>
          </section>
          {data.warnings.length ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              {data.warnings.map((w) => (
                <p key={w} role="alert" className="text-amber-800">
                  {w}
                </p>
              ))}
            </section>
          ) : (
            <p className="text-teal-700">
              当前检查未发现索引、磁盘、备份或 MRZ 服务告警。
            </p>
          )}
          <p className="text-sm text-slate-500">
            页面打开时每 30
            秒自动刷新，隐藏页面会暂停；后台每分钟检查索引、磁盘、备份和 MRZ
            服务，异常写入容器日志。MRZ 指标来自 sidecar，内存为 sidecar
            进程峰值。
          </p>
        </div>
      )}
    </AppShell>
  );
}

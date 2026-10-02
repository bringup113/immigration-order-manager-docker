import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import pg from "pg";

const execute = promisify(execFile);
const base = (process.env.MIGRA_BASE_URL || "http://127.0.0.1:3310").replace(/\/$/, "");
const username = process.env.MIGRA_TEST_USERNAME;
const password = process.env.MIGRA_TEST_PASSWORD;
const databaseUrl = process.env.MIGRA_DATABASE_URL;
const output = process.env.MIGRA_PERF_OUTPUT || "docs/performance-results.json";
const dockerContainers = (process.env.MIGRA_PERF_DOCKER_CONTAINERS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!username || !password) throw new Error("缺少 MIGRA_TEST_USERNAME 或 MIGRA_TEST_PASSWORD。");

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  body: new URLSearchParams({ username, password }),
  redirect: "manual",
});
const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
if (!cookie) throw new Error(`登录失败：HTTP ${login.status}`);

const paths = [
  "/api/data/orders",
  "/api/data/orders?page=80",
  "/api/data/orders?surface=mobile&pageSize=10",
  "/api/data/search?q=needle2999",
  `/api/data/search?q=${encodeURIComponent("材料")}`,
  "/api/data/search?q=zhangsan2999",
  "/api/orders/LOAD-002999?section=workflow",
  "/api/orders/LOAD-002999?section=finance",
  "/api/orders/LOAD-002999?section=people",
  "/api/data/dashboard",
  "/api/data/dashboard?surface=mobile&range=all&page=2&pageSize=15&summary=0",
];
const results = [];
const database = databaseUrl ? new pg.Client({ connectionString: databaseUrl }) : null;
if (database) await database.connect();

async function resourceSnapshot() {
  if (!dockerContainers.length) return null;
  const result = await execute("docker", [
    "stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}} {{.CPUPerc}}", ...dockerContainers,
  ], { encoding: "utf8" });
  return result.stdout.trim();
}

async function pendingSearchJobs() {
  if (!database) return null;
  const result = await database.query("SELECT count(*)::int AS value FROM search_jobs");
  return Number(result.rows[0]?.value ?? 0);
}

function summary(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  values.sort((left, right) => left - right);
  return {
    count: values.length,
    p50: Math.round(values[Math.floor(values.length * 0.5)]),
    p95: Math.round(values[Math.floor(values.length * 0.95)]),
    max: Math.round(values.at(-1)),
  };
}

async function run(concurrency, seconds, label) {
  const started = performance.now();
  const deadline = started + seconds * 1000;
  const timings = [];
  const errors = {};
  const byPath = {};
  const samples = [];
  let index = 0;
  const timer = dockerContainers.length
    ? setInterval(() => { void resourceSnapshot().then((value) => value && samples.push(value)).catch(() => undefined); }, 5000)
    : null;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      const path = paths[index++ % paths.length];
      const requestStarted = performance.now();
      try {
        const response = await fetch(`${base}${path}`, {
          headers: { cookie },
          signal: AbortSignal.timeout(20000),
        });
        await response.arrayBuffer();
        if (response.status !== 200) errors[response.status] = (errors[response.status] || 0) + 1;
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        errors[name] = (errors[name] || 0) + 1;
      }
      const elapsed = performance.now() - requestStarted;
      timings.push(elapsed);
      (byPath[path] ??= []).push(elapsed);
    }
  }));
  if (timer) clearInterval(timer);
  const elapsedSeconds = (performance.now() - started) / 1000;
  const result = {
    label,
    concurrency,
    seconds: Math.round(elapsedSeconds),
    ...summary(timings),
    rps: +(timings.length / elapsedSeconds).toFixed(1),
    errors,
    byPath: Object.fromEntries(Object.entries(byPath).map(([path, values]) => [path, summary(values)])),
    samples,
    pending: await pendingSearchJobs(),
  };
  results.push(result);
  console.log(JSON.stringify(result));
  fs.writeFileSync(output, JSON.stringify(results, null, 2));
}

try {
  await run(5, 20, "indexing");
  if (database) {
    const deadline = Date.now() + 600000;
    while ((await pendingSearchJobs()) > 0) {
      if (Date.now() > deadline) throw new Error("索引队列在十分钟内没有清空。");
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  const search = await fetch(`${base}/api/data/search?q=deep2999`, { headers: { cookie } }).then((response) => response.json());
  if (!search.orders.some((order) => order.order_no === "LOAD-002999")) throw new Error("深层订单信息无法搜索。");
  for (const concurrency of [1, 5, 10, 20]) await run(concurrency, 25, "steady");
  await run(5, 60, "sustained");
} finally {
  await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie }, redirect: "manual" }).catch(() => undefined);
  if (database) await database.end();
}

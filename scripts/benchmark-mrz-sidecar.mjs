#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const rawArgs = process.argv.slice(2);
const urlArg = rawArgs.find((value) => value.startsWith("http://") || value.startsWith("https://"));
const runsIndex = rawArgs.indexOf("--runs");
const parallelIndex = rawArgs.indexOf("--parallel");
const runs = Math.max(1, Number(runsIndex >= 0 ? rawArgs[runsIndex + 1] : 5) || 5);
const parallel = Math.max(1, Number(parallelIndex >= 0 ? rawArgs[parallelIndex + 1] : 1) || 1);
const url = (urlArg || process.env.MRZ_SIDECAR_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const optionValueIndexes = new Set([
  ...(runsIndex >= 0 ? [runsIndex + 1] : []),
  ...(parallelIndex >= 0 ? [parallelIndex + 1] : []),
]);
const files = rawArgs.filter((value, index) => !value.startsWith("--") && value !== urlArg && !optionValueIndexes.has(index));
const inputs = files.length ? files : ["tests/Passport.jpg"];

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(2));
}

async function scan(file) {
  const body = await readFile(file);
  const started = performance.now();
  const response = await fetch(`${url}/scan`, {
    method: "POST",
    headers: {
      "Content-Type": extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg",
      "Content-Length": String(body.byteLength),
      "X-Filename": basename(file),
    },
    body,
  });
  const elapsed = performance.now() - started;
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { error: `HTTP ${response.status}` };
  }
  return {
    file: basename(file),
    status: response.status,
    elapsed_ms: Number(elapsed.toFixed(2)),
    ok: payload.ok === true,
    mrz_detected: payload.mrz_detected === true,
    queue_wait_ms: payload.queue_wait_ms,
    processing_ms: payload.processing_ms,
    error: payload.error,
  };
}

const results = [];
for (const file of inputs) {
  for (let offset = 0; offset < runs; offset += parallel) {
    const batch = Array.from({ length: Math.min(parallel, runs - offset) }, () => scan(file));
    results.push(...await Promise.all(batch));
  }
}

const processing = results.map((item) => item.processing_ms).filter((value) => Number.isFinite(value));
const elapsed = results.map((item) => item.elapsed_ms).filter((value) => Number.isFinite(value));
const metricsResponse = await fetch(`${url}/metrics`);
const metrics = await metricsResponse.json();
console.log(JSON.stringify({
  service: url,
  runs,
  parallel,
  // Array#map passes the index as a second argument; basename treats that
  // argument as a suffix, so use an explicit one-argument callback.
  inputs: inputs.map((input) => basename(input)),
  summary: {
    total: results.length,
    success: results.filter((item) => item.ok).length,
    detected: results.filter((item) => item.mrz_detected).length,
    client_elapsed_ms: { p50: percentile(elapsed, 0.5), p95: percentile(elapsed, 0.95) },
    processing_ms: { p50: percentile(processing, 0.5), p95: percentile(processing, 0.95) },
  },
  metrics,
  results,
}, null, 2));

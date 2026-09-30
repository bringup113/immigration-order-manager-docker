import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

const baseUrl = process.env.MIGRA_BASE_URL;
const username = process.env.MIGRA_TEST_USERNAME;
const password = process.env.MIGRA_TEST_PASSWORD;
const uploadRoot = process.env.MIGRA_TEST_UPLOAD_ROOT;
const enabled =
  process.env.MIGRA_MRZ_TRANSFER_TEST === "1" &&
  Boolean(baseUrl && username && password);

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    body: new URLSearchParams({ username, password }),
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return cookie;
}

test(
  "MRZ upload streaming stays available, bounded, and self-cleaning",
  { skip: !enabled, timeout: 60_000 },
  async () => {
    const cookie = await login();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const jobs = new Map();
    let server;

    const upload = (bytes) => {
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: "image/png" }), "护照.png");
      return fetch(`${baseUrl}/api/mrz/scan`, {
        method: "POST",
        headers: { cookie },
        body: form,
      });
    };

    try {
      const unavailable = await upload(png);
      assert.equal(unavailable.status, 200);
      assert.match(await unavailable.text(), /"type":"error"/);
      assert.equal((await upload(Buffer.alloc(20 * 1024 * 1024 + 1))).status, 413);

      server = createServer(async (request, response) => {
        if (request.method === "POST" && request.url?.startsWith("/jobs")) {
          for await (const chunk of request) void chunk;
          const id = `job-${jobs.size + 1}`;
          jobs.set(id, { completed: false });
          response.writeHead(202, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ job_id: id, status: "queued" }));
          return;
        }
        if (request.method === "GET" && request.url?.startsWith("/jobs/")) {
          const id = request.url.slice("/jobs/".length);
          const job = jobs.get(id);
          if (!job) {
            response.writeHead(404, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "missing" }));
            return;
          }
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(job.completed
            ? { job_id: id, status: "completed", result: { ok: true, mrz_detected: true, mrz_lines: ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"] } }
            : { job_id: id, status: "recognizing", result: null }));
          return;
        }
        response.writeHead(404).end();
      });
      await new Promise((resolve) => server.listen(9999, "0.0.0.0", resolve));

      const first = await upload(png);
      const second = await upload(png);
      const deadline = Date.now() + 5_000;
      while (jobs.size < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(jobs.size, 2);
      assert.equal((await upload(png)).status, 429);

      for (const job of jobs.values()) job.completed = true;
      assert.match(await first.text(), /"type":"result"/);
      assert.match(await second.text(), /"type":"result"/);

      if (uploadRoot) {
        const remaining = await readdir(`${uploadRoot}/.incoming`).catch((error) => {
          if (error?.code === "ENOENT") return [];
          throw error;
        });
        assert.deepEqual(remaining, []);
      }
    } finally {
      server?.closeAllConnections();
      if (server) await new Promise((resolve) => server.close(resolve));
    }
  },
);

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
    const pendingResponses = [];
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
      assert.equal((await upload(png)).status, 503);
      assert.equal((await upload(Buffer.alloc(20 * 1024 * 1024 + 1))).status, 413);

      server = createServer(async (request, response) => {
        for await (const chunk of request) void chunk;
        pendingResponses.push(response);
      });
      await new Promise((resolve) => server.listen(9999, "0.0.0.0", resolve));

      const first = upload(png);
      const second = upload(png);
      const deadline = Date.now() + 5_000;
      while (pendingResponses.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(pendingResponses.length, 2);
      assert.equal((await upload(png)).status, 429);

      for (const response of pendingResponses) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: true, mrz_detected: true }));
      }
      assert.equal((await first).status, 200);
      assert.equal((await second).status, 200);

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

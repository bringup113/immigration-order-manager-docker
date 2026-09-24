import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ApiRequestError,
  fetchApiJson,
  isAbortError,
  readApiResponse,
} from "../lib/api-client.ts";
import {
  normalizeOrderDetailTab,
  orderDetailHref,
} from "../lib/order-navigation.ts";
import { safeReturnPath } from "../lib/safe-return-path.ts";

test("mobile routes stay on the mobile surface except for the explicit switch in My", () => {
  const mobileSources = [
    "app/m/orders/page.tsx",
    "app/m/search/page.tsx",
    "components/mobile/mobile-order-detail.tsx",
    "components/mobile/mobile-security.tsx",
    "components/mobile/mobile-shell.tsx",
  ].map((file) => readFileSync(file, "utf8")).join("\n");

  for (const desktopPrefix of ["/orders", "/projects", "/agents", "/settings"]) {
    assert.equal(
      mobileSources.includes(`\"${desktopPrefix}`) ||
        mobileSources.includes(`\`${desktopPrefix}`),
      false,
      `${desktopPrefix} must not be linked from the normal mobile flow`,
    );
  }

  const me = readFileSync("app/m/me/page.tsx", "utf8");
  assert.match(me, /切换到桌面版/);
  assert.match(me, /desktopHref/);
});

test("mobile security stays mobile and PWA caching excludes business data", () => {
  const securityPage = readFileSync("app/m/me/security/page.tsx", "utf8");
  const security = readFileSync("components/mobile/mobile-security.tsx", "utf8");
  const manifest = readFileSync("app/manifest.ts", "utf8");
  const worker = readFileSync("public/sw.js", "utf8");

  assert.match(securityPage, /backHref="\/m\/me"/);
  assert.doesNotMatch(security, /href=[{\"]?[`\"]?\/(orders|projects|agents|settings)/);
  assert.match(manifest, /start_url: "\/m"/);
  assert.match(manifest, /scope: "\/m"/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /\/_next\/static\//);
  assert.match(worker, /fetch\(request\)\.catch\(\(\) => caches\.match\(OFFLINE_URL\)\)/);
  assert.doesNotMatch(worker, /skipWaiting/);
  assert.doesNotMatch(worker, /\/api\//);
});

test("order module navigation only emits legal desktop and mobile links", () => {
  assert.equal(normalizeOrderDetailTab("finance"), "finance");
  assert.equal(normalizeOrderDetailTab("unknown"), "workflow");
  assert.equal(orderDetailHref("ABC / 1", "people"), "/orders/ABC%20%2F%201?tab=people");
  assert.equal(orderDetailHref("ABC / 1", "invalid", "mobile"), "/m/orders/ABC%20%2F%201");
  assert.equal(orderDetailHref("ABC / 1", undefined, "mobile"), "/m/orders/ABC%20%2F%201");
  assert.equal(orderDetailHref("ABC / 1", "workflow", "mobile"), "/m/orders/ABC%20%2F%201?tab=workflow");
});

test("mobile order list shares desktop sorting and detail defaults to workflow", () => {
  const desktop = readFileSync("app/orders/page.tsx", "utf8");
  const mobile = readFileSync("app/m/orders/page.tsx", "utf8");
  const detailPage = readFileSync("app/m/orders/[orderNo]/page.tsx", "utf8");
  const detail = readFileSync("components/mobile/mobile-order-detail.tsx", "utf8");

  assert.match(desktop, /DEFAULT_ORDER_SORT/);
  assert.match(mobile, /DEFAULT_ORDER_SORT/);
  assert.match(mobile, /orderSortOptions\.map/);
  assert.doesNotMatch(mobile, /mobileSortOptions/);
  assert.match(detailPage, /: "workflow"/);
  assert.doesNotMatch(detail, /订单概览|"overview"/);
});

test("mobile order detail uses a compact app layout with contextual actions", () => {
  const detail = readFileSync("components/mobile/mobile-order-detail.tsx", "utf8");
  const workflow = readFileSync("components/mobile/mobile-workflow-actions.tsx", "utf8");
  const cash = readFileSync("components/mobile/mobile-cash-actions.tsx", "utf8");
  const materials = readFileSync("components/mobile/mobile-materials.tsx", "utf8");

  assert.match(detail, /sticky top-14/);
  assert.match(detail, /gridTemplateColumns/);
  assert.match(detail, /办理流程/);
  assert.match(workflow, /fixed inset-x-0/);
  assert.match(cash, /fixed inset-x-0/);
  assert.match(materials, /aria-label="选择申请人"/);
  assert.doesNotMatch(workflow, /快捷办理/);
  assert.doesNotMatch(cash, /登记实际收付/);
});

test("mobile workbench preserves context and never renders a stale order module", () => {
  const dashboard = readFileSync("app/m/page.tsx", "utf8");
  const search = readFileSync("app/m/search/page.tsx", "utf8");
  const detailPage = readFileSync("app/m/orders/[orderNo]/page.tsx", "utf8");
  const detail = readFileSync("components/mobile/mobile-order-detail.tsx", "utf8");

  assert.match(dashboard, /useSearchParams/);
  assert.match(dashboard, /sourceParams\.set\("range", range\)/);
  assert.match(detailPage, /dashboardRange/);
  assert.match(detail, /dataSection === tab/);
  assert.match(detail, /正在读取当前模块/);
  assert.match(search, /if \(!term\)/);
  assert.match(search, /migra-mobile-search-state/);
  assert.match(search, /Math\.min\(4000/);
  assert.match(search, /projectId/);
  assert.match(search, /agentId/);
  assert.match(detail, /sectionReady/);
});

test("mobile high-frequency actions use precise filters, pagination and mobile-sized forms", () => {
  const dashboard = readFileSync("lib/dashboard-query.ts", "utf8");
  const orders = readFileSync("lib/order-list.ts", "utf8");
  const home = readFileSync("app/m/page.tsx", "utf8");
  const cash = readFileSync("components/mobile/mobile-cash-actions.tsx", "utf8");
  const workflow = readFileSync("components/mobile/mobile-workflow-actions.tsx", "utf8");
  const materials = readFileSync("components/mobile/mobile-materials.tsx", "utf8");

  assert.match(dashboard, /source_id/);
  assert.match(dashboard, /reminderPagination/);
  assert.match(home, /继续查看提醒/);
  assert.match(orders, /o\.project_id=\?/);
  assert.match(orders, /o\.agent_id=\?/);
  assert.match(cash, /!h-dvh/);
  assert.match(workflow, /!h-dvh/);
  assert.match(materials, /上传材料/);
  assert.match(materials, /立即拍照/);
  assert.match(materials, /放弃护照核对结果/);
  assert.match(materials, /!h-dvh/);
});

test("mobile reads request section projections and skip desktop-only dashboard work", () => {
  const detailClient = readFileSync("components/mobile/mobile-order-detail.tsx", "utf8");
  const detailQuery = readFileSync("lib/order-detail-query.ts", "utf8");
  const dashboardClient = readFileSync("app/m/page.tsx", "utf8");
  const dashboardQuery = readFileSync("lib/dashboard-query.ts", "utf8");

  assert.match(detailClient, /surface: "mobile"/);
  assert.match(detailQuery, /mobileSurface/);
  assert.match(detailQuery, /includeSteps/);
  assert.match(detailQuery, /includePlans/);
  assert.match(detailQuery, /includeMaterials/);
  assert.match(dashboardClient, /surface=mobile/);
  assert.match(dashboardQuery, /canReadFinance && !mobileSurface/);
});

test("desktop date label tolerates browser and Docker timezone boundaries", () => {
  const shell = readFileSync("components/app-shell.tsx", "utf8");
  assert.match(shell, /suppressHydrationWarning/);
  assert.match(shell, /Intl\.DateTimeFormat/);
});

test("return paths preserve mobile deep links and reject external or auth loops", () => {
  assert.equal(
    safeReturnPath("/m/orders/ABC-1?tab=finance"),
    "/m/orders/ABC-1?tab=finance",
  );
  for (const value of [
    "https://example.com/m/orders/1",
    "//example.com/m/orders/1",
    "/\\example.com/m/orders/1",
    "/api/auth/login?return_to=/m/",
    "/signin-with-chatgpt",
    "/m/orders/1\nLocation:https://example.com",
  ])
    assert.equal(safeReturnPath(value), "/", value);
});

test("API response reader distinguishes JSON, permissions, and invalid formats", async () => {
  assert.deepEqual(
    await readApiResponse(new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    })),
    { ok: true },
  );

  await assert.rejects(
    () => readApiResponse(new Response(JSON.stringify({ error: "禁止访问" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })),
    (error) =>
      error instanceof ApiRequestError &&
      error.status === 403 &&
      error.message === "禁止访问",
  );

  await assert.rejects(
    () => readApiResponse(new Response("login html", {
      status: 200,
      headers: { "content-type": "text/html" },
    })),
    (error) =>
      error instanceof ApiRequestError && error.code === "NON_JSON_RESPONSE",
  );

  const controller = new AbortController();
  controller.abort();
  assert.equal(isAbortError(controller.signal.reason), true);
});

test("a 401 API response announces session expiry without treating it as empty data", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const events = [];
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "请重新登录。" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) };
  try {
    await assert.rejects(
      () => fetchApiJson("/api/data/orders"),
      (error) =>
        error instanceof ApiRequestError &&
        error.code === "SESSION_EXPIRED",
    );
    assert.deepEqual(events, ["migra-session-expired"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

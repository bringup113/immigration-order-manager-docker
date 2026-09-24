/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner supports external Playwright. */
const assert = require("node:assert/strict");
const { mkdirSync, readFileSync } = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const base = (process.env.MIGRA_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const orderNo = "CI-FIXTURE-2026091501";
const credentialText = process.env.MIGRA_TEST_CREDENTIAL_FILE
  ? readFileSync(process.env.MIGRA_TEST_CREDENTIAL_FILE, "utf8") : "";
const username = process.env.MIGRA_TEST_USERNAME || credentialText.match(/^账号：(.+)$/m)?.[1];
const password = process.env.MIGRA_TEST_PASSWORD || credentialText.match(/^密码：(.+)$/m)?.[1];
if (!username || !password) throw new Error("Provide isolated browser-test credentials");
const screenshotDir = process.env.MIGRA_MOBILE_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

(async () => {
  const manifestResponse = await fetch(`${base}/manifest.webmanifest`, { redirect: "manual" });
  assert.equal(manifestResponse.status, 200, "PWA manifest must be public");
  const manifest = await manifestResponse.json();
  assert.equal(manifest.start_url, "/m");
  assert.equal(manifest.scope, "/m");
  assert.equal(manifest.display, "standalone");
  const workerResponse = await fetch(`${base}/sw.js`, { redirect: "manual" });
  assert.equal(workerResponse.status, 200, "service worker must be public");
  assert.match(workerResponse.headers.get("cache-control") || "", /no-cache|no-store/);
  assert.doesNotMatch(await workerResponse.text(), /\/api\//);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const deepLink = `/m/orders/${orderNo}?tab=finance`;
    await page.goto(`${base}${deepLink}`);
    await page.waitForURL(/\/api\/auth\/login\?/);
    const loginUrl = new URL(page.url());
    assert.equal(loginUrl.searchParams.get("return_to"), deepLink);
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "进入系统" }).click();
    await page.waitForURL(`${base}${deepLink}`);
    await page.getByRole("heading", { name: "收付款计划" }).waitFor();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/detail.png`, fullPage: true });
    assert.equal(await page.getByRole("link", { name: "订单收支" }).getAttribute("aria-current"), "page");
    console.log("PASS protected mobile deep link and finance read");

    await page.goto(`${base}/m`);
    await page.getByRole("navigation", { name: "手机端主导航" }).getByRole("link").first().waitFor();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/home.png`, fullPage: true });
    assert.equal(await page.getByRole("navigation", { name: "手机端主导航" }).getByRole("link").count(), 4);
    await page.getByText("需要处理的事").waitFor();
    await page.goto(`${base}/m/orders`);
    await page.getByText("CI 主申请人").first().waitFor();
    assert.equal(await page.getByLabel("订单排序").inputValue(), "signed_desc");
    assert.deepEqual(await page.getByLabel("订单排序").locator("option").evaluateAll((options) => options.map((option) => option.value)), ["signed_desc", "signed_asc", "created_desc", "updated_desc"]);
    assert.equal(await page.locator('a[href^="/orders"], a[href^="/projects"], a[href^="/agents"], a[href^="/settings"]').count(), 0);
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/orders.png`, fullPage: true });
    await page.getByRole("link", { name: /CI 主申请人.*CI 固定测试项目/ }).first().click();
    await page.waitForURL(new RegExp(`/m/orders/${orderNo}$`));
    await page.getByRole("heading", { name: "办理流程" }).waitFor();
    assert.equal(await page.getByRole("link", { name: "办理与跟进" }).getAttribute("aria-current"), "page");
    assert.equal(await page.getByRole("navigation", { name: "订单详情模块" }).getByRole("link").count(), 4);
    assert.equal(await page.getByText("订单概览").count(), 0);
    console.log("PASS real order list sorting and four-module detail");

    await page.goto(`${base}/m/search`);
    await page.getByRole("textbox", { name: "全局搜索关键词" }).fill("CI 主申请人");
    await page.getByText("CI 固定测试项目 · CI 主申请人").first().waitFor({ timeout: 30000 });
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/search.png`, fullPage: true });
    await page.getByText("CI 固定测试项目 · CI 主申请人").first().click();
    await page.waitForURL(new RegExp(`/m/orders/${orderNo}(\\?[^#]*)?$`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log("PASS real mobile search and 390px viewport");

    await page.goto(`${base}/m/me`);
    await page.getByRole("link", { name: /登录与安全/ }).click();
    await page.waitForURL(`${base}/m/me/security`);
    await page.getByRole("heading", { name: "修改密码" }).waitFor();
    await page.getByRole("heading", { name: "双重验证" }).waitFor();
    await page.getByRole("heading", { name: "登录设备" }).waitFor();
    assert.equal(await page.locator('a[href^="/orders"], a[href^="/projects"], a[href^="/agents"], a[href^="/settings"]').count(), 0);
    console.log("PASS mobile security and PWA public resources");

    const viewportRoutes = [
      "/m",
      "/m/orders",
      `/m/orders/${orderNo}`,
      "/m/search",
      "/m/me",
    ];
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of viewportRoutes) {
        await page.goto(`${base}${route}`);
        await page.getByRole("navigation", { name: "手机端主导航" }).waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          `${route} overflows at ${width}px`,
        );
      }
      const navTargets = await page
        .getByRole("navigation", { name: "手机端主导航" })
        .getByRole("link")
        .evaluateAll((links) => links.map((link) => {
          const rect = link.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }));
      assert.equal(
        navTargets.every((target) => target.width >= 44 && target.height >= 44),
        true,
        `navigation touch targets are too small at ${width}px`,
      );
      if (screenshotDir) {
        await page.screenshot({ path: `${screenshotDir}/me-${width}.png`, fullPage: true });
      }
    }
    console.log("PASS 360/390/430px mobile layouts and touch targets");

    const workerScope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    });
    assert.equal(new URL(workerScope).pathname, "/m");
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const cachedUrls = await page.evaluate(async () => {
      const keys = await caches.keys();
      const requests = await Promise.all(
        keys
          .filter((key) => key.startsWith("migra-mobile-static-"))
          .map(async (key) => (await caches.open(key)).keys()),
      );
      return requests.flat().map((request) => request.url);
    });
    assert.equal(cachedUrls.some((url) => new URL(url).pathname === "/mobile-offline.html"), true);
    assert.equal(cachedUrls.some((url) => new URL(url).pathname.startsWith("/api/")), false);
    assert.equal(cachedUrls.some((url) => new URL(url).pathname === "/m" || new URL(url).pathname.startsWith("/m/")), false);

    await page.context().setOffline(true);
    try {
      await page.goto(`${base}/m/orders`);
      await page.getByRole("heading", { name: "当前没有网络连接" }).waitFor();
      await page.getByText("不会在离线状态保存或补发订单").waitFor();
    } finally {
      await page.context().setOffline(false);
    }
    console.log("PASS scoped service worker, private-data cache boundary and offline fallback");

    await page.goto(`${base}/m/orders/${orderNo}?tab=workflow`);
    await page.getByRole("button", { name: "完成步骤" }).click();
    await page.getByRole("dialog", { name: "完成当前步骤" }).getByRole("button", { name: "确认完成" }).click();
    await page.getByText("CI 后续流程").waitFor();
    await page.getByText("进行中", { exact: true }).waitFor();
    await page.getByRole("button", { name: "新增跟进" }).click();
    await page.getByRole("textbox", { name: "本次跟进内容" }).fill("CI 手机端跟进");
    await page.getByRole("textbox", { name: "详细说明（可选）" }).fill("已通过手机端登记");
    await page.getByRole("button", { name: "保存跟进" }).click();
    await page.getByText("跟进记录 · 本页 1 条").waitFor();
    await page.getByText("跟进记录 · 本页 1 条").click();
    await page.getByText("CI 手机端跟进").waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS real mobile step completion and follow-up write");

    await page.goto(`${base}/m/orders/${orderNo}?tab=finance`);
    await page.getByRole("button", { name: "登记收款" }).click();
    await page.getByLabel("关联计划（可选）").selectOption("plan_ci_fixture");
    await page.getByLabel("原币金额（USD）").fill("50");
    await page.getByRole("button", { name: "保存收款" }).click();
    await page.getByText("收款 · CI 应收计划").waitFor();
    await page.getByText("已结清").waitFor();
    await page.getByRole("button", { name: "登记付款" }).click();
    await page.getByLabel("付款说明").fill("CI 手机端付款");
    await page.getByLabel("实际币种").selectOption("MYR");
    await page.getByLabel("原币金额（MYR）").fill("404");
    assert.equal(await page.getByLabel("本位币金额（USD） · 自动算出").inputValue(), "100.00");
    await page.getByRole("button", { name: "保存付款" }).click();
    await page.getByText("付款 · CI 手机端付款").waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS real mobile receipt, payment and original-currency settlement");

    await page.goto(`${base}/m/orders/${orderNo}?tab=people`);
    await page.getByText("CI 辅助材料").waitFor();
    const uploaded = page.waitForResponse((response) => response.url().endsWith("/api/material-files") && response.request().method() === "POST");
    await page.getByRole("button", { name: "CI 主申请人 CI 辅助材料 上传材料" }).click();
    await page.getByLabel("CI 主申请人 CI 辅助材料 选择文件上传").setInputFiles({
      name: "mobile-material.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZxkAAAAASUVORK5CYII=", "base64"),
    });
    const uploadResponse = await uploaded;
    assert.equal(uploadResponse.status(), 201);
    const savedFile = await uploadResponse.json();
    await page.getByText(savedFile.storedName).waitFor();
    await page.getByText(savedFile.storedName).locator("..").getByRole("button", { name: "预览" }).click();
    await page.getByRole("dialog", { name: savedFile.storedName }).waitFor();
    assert.equal(await page.getByRole("link", { name: /下载/ }).count(), 0);
    await page.getByRole("dialog", { name: savedFile.storedName }).getByRole("button", { name: "Close" }).click();
    assert.deepEqual(errors, []);
    console.log("PASS real mobile material upload and inline preview");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

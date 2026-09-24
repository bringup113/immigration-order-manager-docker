/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner supports external Playwright. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const base = (process.env.MIGRA_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const credentialText = process.env.MIGRA_TEST_CREDENTIAL_FILE
  ? readFileSync(process.env.MIGRA_TEST_CREDENTIAL_FILE, "utf8") : "";
const username = process.env.MIGRA_TEST_USERNAME || credentialText.match(/^账号：(.+)$/m)?.[1];
const password = process.env.MIGRA_TEST_PASSWORD || credentialText.match(/^密码：(.+)$/m)?.[1];

if (!username || !password) {
  throw new Error("Set MIGRA_TEST_USERNAME and MIGRA_TEST_PASSWORD");
}

async function choose(page, trigger, optionName) {
  await trigger.click();
  await page.getByRole("option", { name: optionName }).click();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${base}/api/auth/login`);
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "进入系统" }).click();
    await page.waitForURL(`${base}/`);

    const reminder = page.locator("a.todo-row", { hasText: "CI 应收计划" });
    await reminder.waitFor();
    await reminder.click();
    await page.waitForURL(/\/orders\/CI-FIXTURE-2026091501\?tab=finance$/);
    const financeTab = page.getByRole("tab", { name: "订单收支" });
    assert.equal(await financeTab.getAttribute("data-state"), "active");
    console.log("PASS reminder opens the finance tab");

    await page.getByRole("button", { name: "登记收款" }).first().click();
    const cashDialog = page.getByRole("dialog", { name: "登记收款" });
    await cashDialog.waitFor();
    await choose(page, cashDialog.getByRole("combobox").nth(1), /MYR/);
    await cashDialog.getByLabel("原币金额（MYR）").fill("404");
    assert.equal(await cashDialog.getByLabel("本位币金额（USD）").inputValue(), "100.00");
    await cashDialog.getByLabel("本位币金额（USD）").fill("80");
    assert.equal(await cashDialog.getByLabel("汇率（1 USD = ? MYR）").inputValue(), "5.05");
    await cashDialog.getByLabel("汇率（1 USD = ? MYR）").fill("4.04");
    assert.equal(await cashDialog.getByLabel("原币金额（MYR）").inputValue(), "323.20");
    assert.equal(await cashDialog.getByText("改为自动计算").count(), 0);
    await cashDialog.getByRole("button", { name: "取消" }).click();
    console.log("PASS desktop cash fields infer the third value without a manual switch");

    await page.goto(`${base}/orders`);
    await page.getByRole("heading", { name: "订单管理" }).waitFor();
    const sortResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/data/orders?") &&
        response.url().includes("sort=signed_asc") &&
        response.status() === 200,
    );
    await choose(
      page,
      page.getByRole("combobox", { name: "订单排序" }),
      "签约日期：从旧到新",
    );
    await sortResponse;
    assert.match(
      await page.getByRole("combobox", { name: "订单排序" }).innerText(),
      /从旧到新/,
    );
    console.log("PASS order list changes to the selected server sort");

    await page.goto(`${base}/orders/new`);
    await page.getByRole("heading", { name: "新增订单" }).waitFor();
    const projectSection = page.locator("section", {
      has: page.getByRole("heading", { name: "1. 项目、代理与签约信息" }),
    });
    const signedAt = projectSection.locator('input[type="date"]');
    await signedAt.fill("2024-02-28");
    const projectSelectors = projectSection.getByRole("combobox");
    await choose(page, projectSelectors.nth(0), /CI 固定测试项目/);
    await choose(page, projectSelectors.nth(1), "CI 固定测试代理");

    const workflowSection = page.locator("section", {
      has: page.getByRole("heading", { name: "3. 办理流程" }),
    });
    const plansSection = page.locator("section", {
      has: page.getByRole("heading", { name: "4. 订单收付款计划" }),
    });
    const workflowName = workflowSection.locator("input").first();
    await workflowName.waitFor();
    assert.equal(await workflowName.inputValue(), "CI 浏览器流程");
    const workflowDate = workflowSection.locator('input[type="date"]').first();
    const planDate = plansSection.locator('input[type="date"]').first();
    assert.equal(await workflowDate.inputValue(), "2024-03-06");
    assert.equal(await planDate.inputValue(), "2024-03-29");

    await signedAt.fill("2024-03-01");
    assert.equal(await workflowDate.inputValue(), "2024-03-08");
    assert.equal(await planDate.inputValue(), "2024-03-31");
    await workflowDate.fill("2099-01-01");
    await signedAt.fill("2024-03-02");
    assert.equal(await workflowDate.inputValue(), "2099-01-01");
    assert.equal(await planDate.inputValue(), "2024-04-01");
    console.log("PASS contract date rebases templates and preserves manual dates");

    const applicantSection = page.locator("section", {
      has: page.getByRole("heading", { name: "2. 申请人与护照资料" }),
    });
    await applicantSection.waitFor();
    await applicantSection.locator("input:not([type])").first().fill("浏览器仅姓名申请人");
    console.log("PASS applicant display name is editable without passport data");
    const createButton = page.getByRole("button", { name: "创建订单" });
    await createButton.waitFor({ state: "visible" });
    try {
      await page.waitForFunction(
        () => {
          const button = [...document.querySelectorAll("button")].find((item) =>
            item.textContent?.includes("创建订单"),
          );
          return Boolean(button && !button.disabled);
        },
        undefined,
        { timeout: 15_000 },
      );
    } catch (error) {
      const diagnostics = {
        orderNo: await projectSection.locator("input[readonly]").inputValue(),
        planValues: await plansSection.locator("input").evaluateAll((inputs) =>
          inputs.map((input) => ({ type: input.type, value: input.value })),
        ),
        messages: await page.locator("p.text-rose-700").allTextContents(),
      };
      throw new Error(
        `创建订单按钮未启用：${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    }
    await createButton.click();
    await page.waitForURL(/\/orders\/[^/?]+$/);
    await page.getByText("主申请人：浏览器仅姓名申请人", { exact: true }).waitFor();
    console.log("PASS name-only applicant creates an order without a passport upload");

    const deepLink = `${base}/orders/CI-FIXTURE-2026091501?tab=finance`;
    await page.goto(deepLink);
    await page.getByRole("tab", { name: "订单收支" }).waitFor();
    await page.context().clearCookies();
    await page.evaluate(() => window.dispatchEvent(new Event("migra-user-changed")));
    await page.waitForURL((url) => url.pathname === "/api/auth/login");
    assert.equal(new URL(page.url()).searchParams.get("return_to"), "/orders/CI-FIXTURE-2026091501?tab=finance");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "进入系统" }).click();
    await page.waitForURL(deepLink);
    assert.equal(
      await page.getByRole("tab", { name: "订单收支" }).getAttribute("data-state"),
      "active",
    );
    console.log("PASS session expiry and login preserve the order module deep link");

    assert.deepEqual(pageErrors, []);
    console.log("PASS current-source browser flow has no page errors");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

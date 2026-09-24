/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner supports external Playwright. */
const assert = require("node:assert/strict");
const { mkdirSync } = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const base = (process.env.MIGRA_BASE_URL || "http://127.0.0.1:33001").replace(/\/$/, "");
const screenshotDir = process.env.MIGRA_MOBILE_SCREENSHOT_DIR;
const viewportWidth = Number(process.env.MIGRA_MOBILE_WIDTH || 390);
const orderNo = "CI-MOBILE-2026092101";
const pageInfo = (page, size, hasMore = false, loaded = true) => ({ page, pageSize: size, hasMore, loaded });
const pagination = (orders = pageInfo(1, 12), projects = pageInfo(1, 8), agents = pageInfo(1, 8)) => ({ orders, projects, agents });
const listOrder = (index) => ({
  id: `order-${index}`, order_no: index === 1 ? orderNo : `CI-MOBILE-${index}`, status: "ACTIVE",
  owner_user_id: "owner", owner_name: "测试所有者", owner_username: "owner",
  created_at: "2026-09-21T01:00:00Z", signed_at: "2024-02-28", agent_name: "示例代理",
  project_name: `手机测试项目 ${index}`, country: "中国", main_applicant: `申请人 ${index}`,
  current_step: "等待申请材料", current_step_status: "IN_PROGRESS", current_step_due_date: "2026-09-30",
  in_progress_steps: 1, completed_steps: 1, total_steps: 3, pending_follow_up: null, pending_follow_up_date: null,
});
const detail = {
  order: { id: "order-1", order_no: orderNo, version: 1, status: "ACTIVE", project_name_snapshot: "手机测试项目 1", agent_name: "示例代理", owner_name: "测试所有者", signed_at: "2024-02-28", notes: "阅读版备注" },
  applicants: [{ id: "app-1", applicant_type: "MAIN", name: "申请人 1" }],
  steps: [{ id: "step-1", name: "等待申请材料", status: "IN_PROGRESS", due_date: "2026-09-30" }, { id: "step-2", name: "递交申请", status: "PENDING", due_date: "2026-10-10" }],
  mrzRecords: [], plans: [
    { id: "plan-1", plan_type: "RECEIVABLE", name: "首付款", currency: "USD", planned_amount_minor: 100000, planned_base_minor: 100000, allocated_minor: 0, due_date: "2026-10-01" },
    { id: "plan-2", plan_type: "PAYABLE", name: "项目服务费", currency: "CNY", planned_amount_minor: 75000, planned_base_minor: 10000, allocated_minor: 0, due_date: "2026-10-10" },
  ],
  availableCurrencies: [{ currency: "USD", name: "美元", rate_per_usd_scaled: 100000000 }, { currency: "CNY", name: "人民币", rate_per_usd_scaled: 750000000 }],
  materials: [{ id: "material-1", applicant_id: "app-1", name: "护照首页", system_code: "PASSPORT_BIO_PAGE", required: 1 }, { id: "material-common", applicant_id: null, name: "服务合同", required: 1 }], materialFiles: [],
  progress: [], historyHasMore: false, cashEntries: [], cashHasMore: false, tasks: [], assignableUsers: [], closureCheck: { missingRequiredMaterials: 1 }, closureHistory: [],
  receivedBaseMinor: 0, paidBaseMinor: 0, balanceBaseMinor: 0,
};
const dashboard = {
  activeOrders: 1, receivableMinor: 100000, payableMinor: 0, balanceMinor: 0, trend: [],
  reminderCounts: { todayKey: "2026-09-21", overdue: 41, today: 0, week: 1 },
  access: { orders: true, finance: true, materials: true, tasks: true, ordersWrite: true },
  reminders: [
    { source: "材料收集", source_id: "material-reminder", reminder_type: "MATERIAL", target_tab: "people", due_date: "2026-09-20", order_no: orderNo, title: "过期材料", project_name: "手机测试项目 1", main_applicant: "申请人 1" },
    { source: "收付款计划", source_id: "receipt-reminder", reminder_type: "RECEIPT", target_tab: "finance", due_date: "2026-09-22", order_no: orderNo, title: "首付款", project_name: "手机测试项目 1", main_applicant: "申请人 1" },
  ],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: viewportWidth, height: 844 }, extraHTTPHeaders: { "oai-authenticated-user-email": "mobile-test@example.local" } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(`${page.url()}\n${error.stack || error.message}`));
    await page.route("**/api/data/dashboard?**", (route) => {
      const range = new URL(route.request().url()).searchParams.get("range");
      const pageNumber = Number(new URL(route.request().url()).searchParams.get("page") || 1);
      const reminders = dashboard.reminders.filter((item) => range === "overdue" ? item.due_date < dashboard.reminderCounts.todayKey : range === "today" ? item.due_date === dashboard.reminderCounts.todayKey : range === "week" ? item.due_date > dashboard.reminderCounts.todayKey : true);
      route.fulfill({ json: { ...dashboard, reminders: reminders.slice(pageNumber - 1, pageNumber), reminderPagination: { page: pageNumber, pageSize: 1, hasMore: pageNumber < reminders.length } } });
    });
    await page.route("**/api/data/orders?**", (route) => {
      const url = new URL(route.request().url());
      const number = Number(url.searchParams.get("page") || 1);
      route.fulfill({ json: { rows: number === 1 ? Array.from({ length: 10 }, (_, index) => listOrder(index + 1)) : [listOrder(11)], page: number, pageSize: 10, total: 11, totalPages: 2, hasMore: number === 1, owners: [] } });
    });
    let searchRequests = 0;
    await page.route("**/api/data/search?**", (route) => {
      searchRequests += 1;
      const url = new URL(route.request().url());
      const group = url.searchParams.get("group");
      const number = Number(url.searchParams.get("page") || 1);
      route.fulfill({ json: {
        orders: group === "orders" && number === 2 ? [{ order_no: orderNo, project_name: "手机测试项目 1", main_applicant: "申请人 1", agent_name: "示例代理", target_tab: "people" }, { order_no: "CI-MOBILE-2", project_name: "手机测试项目 2", main_applicant: "申请人 2", agent_name: "示例代理", target_tab: "workflow" }] : [{ order_no: orderNo, project_name: "手机测试项目 1", main_applicant: "申请人 1", agent_name: "示例代理", target_tab: "people", match_summary: "护照首页" }],
        projects: group ? [] : [{ id: "project-1", code: "CI", name: "示例项目", country: "中国" }], agents: [],
        pagination: pagination(pageInfo(number, 12, number === 1), pageInfo(1, 8), pageInfo(1, 8)), indexing: false,
      } });
    });
    await page.route("**/api/data/currencies", (route) => route.fulfill({ json: { rows: detail.availableCurrencies } }));
    const mutations = [];
    let conflictNext = false;
    await page.route(`**/api/orders/${orderNo}?**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get("section") === "common")
        await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ json: detail });
    });
    await page.route(`**/api/orders/${orderNo}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      mutations.push(body);
      if (conflictNext) {
        conflictNext = false;
        detail.order.version += 1;
        return route.fulfill({ status: 409, json: { error: "订单已由其他人修改。" } });
      }
      assert.equal(body.expectedVersion, detail.order.version);
      if (body.action === "step") {
        detail.steps[0].status = "COMPLETED";
        detail.steps[1].status = "IN_PROGRESS";
      } else if (body.action === "progress") {
        detail.progress.unshift({ id: "progress-1", progress_date: body.progressDate, title: body.title, details: body.details, next_action: body.nextAction, follow_up_date: body.followUpDate });
      } else if (body.action === "saveCashEntry") {
        const plan = detail.plans.find((item) => item.id === body.orderPlanId);
        if (plan) plan.allocated_minor += plan.currency === body.currency ? Math.round(Number(body.amount) * 100) : Math.round(Number(body.baseAmount) * 100);
        const baseAmountMinor = Math.round(Number(body.baseAmount) * 100);
        if (body.direction === "RECEIPT") detail.receivedBaseMinor += baseAmountMinor;
        else detail.paidBaseMinor += baseAmountMinor;
        detail.cashEntries.unshift({ id: `cash-${detail.cashEntries.length + 1}`, direction: body.direction, description: body.description, currency: body.currency, amount_minor: Math.round(Number(body.amount) * 100), base_amount_minor: baseAmountMinor, entry_date: body.entryDate, plan_name: plan?.name });
      } else if (body.action === "confirmMrz") {
        detail.applicants[0].name = body.fields.name;
        detail.applicants[0].passport_no = body.fields.passportNo;
      }
      detail.order.version += 1;
      return route.fulfill({ status: body.action === "saveCashEntry" ? 201 : 200, json: body.action === "saveCashEntry" ? { id: detail.cashEntries[0].id } : { ok: true } });
    });
    const fileRequests = [];
    await page.route("**/api/material-files", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const fileId = `file-${detail.materialFiles.length + 1}`;
      const body = route.request().postDataBuffer();
      assert.ok(body.includes(Buffer.from("materialId")));
      const materialId = body.includes(Buffer.from("material-common")) ? "material-common" : "material-1";
      fileRequests.push({ fileId, materialId });
      detail.materialFiles.unshift({ id: fileId, material_id: materialId, stored_name: materialId === "material-1" ? "护照首页.jpg" : "服务合同.pdf", mime_type: materialId === "material-1" ? "image/jpeg" : "application/pdf", status: "ACTIVE" });
      return route.fulfill({ status: 201, json: { id: fileId, storedName: detail.materialFiles[0].stored_name } });
    });
    await page.route("**/api/material-files/file-*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZxkAAAAASUVORK5CYII=", "base64") }));
    let scanCount = 0;
    await page.route("**/api/mrz/scan", (route) => {
      scanCount += 1;
      return route.fulfill({ json: { ok: true, mrz_lines: ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"] } });
    });

    await page.goto(`${base}/m`);
    await page.getByRole("navigation", { name: "手机端主导航" }).getByRole("link").first().waitFor();
    assert.equal(await page.getByRole("navigation", { name: "手机端主导航" }).getByRole("link").count(), 4);
    assert.equal(await page.getByRole("button", { name: /逾期.*41/ }).count(), 1, "summary is not derived from the one returned reminder");
    await page.getByRole("button", { name: /逾期.*41/ }).click();
    await page.waitForURL(`${base}/m?range=overdue`);
    await page.getByText("逾期待办 · 41").waitFor();
    await page.getByText("过期材料").waitFor();
    await page.getByText("材料日期").waitFor();
    await page.getByText("已逾期 1 天 · 2026-09-20").waitFor();
    assert.equal(await page.getByText("首付款").count(), 0, "date filter is applied by the API");
    await page.getByRole("button", { name: "查看全部" }).click();
    await page.getByRole("button", { name: "继续查看提醒" }).click();
    await page.getByText("首付款").waitFor();
    await page.getByText("首付款").last().click();
    await page.waitForURL(/\/m\/orders\/CI-MOBILE-2026092101\?tab=finance&from=dashboard$/);
    await page.getByRole("heading", { name: "收付款计划" }).waitFor();
    assert.equal(await page.getByRole("link", { name: "订单收支" }).getAttribute("aria-current"), "page");
    console.log("PASS mobile reminder opens finance module");

    await page.goto(`${base}/m/orders`);
    await page.getByText("申请人 1").first().waitFor();
    const sortSelect = page.getByLabel("订单排序");
    assert.equal(await sortSelect.inputValue(), "signed_desc", "mobile and desktop lists must share the signed-date default");
    assert.deepEqual(await sortSelect.locator("option").evaluateAll((options) => options.map((option) => option.value)), ["signed_desc", "signed_asc", "created_desc", "updated_desc"]);
    await page.getByRole("button", { name: "办理中", exact: true }).click();
    await page.waitForURL(/status=ACTIVE/);
    await page.getByText("申请人 1").first().waitFor();
    assert.equal(await page.getByText("2024-02-28").count(), 0, "list should not display signed date");
    await page.getByRole("button", { name: "下一页" }).click();
    await page.waitForURL(/page=2/);
    await page.getByText("申请人 11").waitFor();
    await page.getByRole("button", { name: "上一页" }).click();
    await page.getByText("申请人 1").first().waitFor();
    await page.getByText("申请人 1").first().click();
    await page.waitForURL(new RegExp(`/m/orders/${orderNo}$`));
    assert.equal(await page.getByRole("link", { name: "办理与跟进" }).getAttribute("aria-current"), "page");
    assert.equal(await page.getByRole("navigation", { name: "订单详情模块" }).getByRole("link").count(), 4);
    assert.equal(await page.getByText("订单概览").count(), 0);
    await page.getByRole("heading", { name: "办理流程" }).waitFor();
    const workflowActions = await page.getByLabel("办理操作").boundingBox();
    const bottomNavigation = await page.getByRole("navigation", { name: "手机端主导航" }).boundingBox();
    assert.ok(workflowActions && bottomNavigation && workflowActions.y + workflowActions.height <= bottomNavigation.y + 1,
      "context actions must stay above the global navigation");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
      "order detail should not overflow horizontally");
    if (screenshotDir) {
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}/detail-workflow.png`, fullPage: true });
    }
    console.log("PASS mobile list sorting, paging and four-module detail");

    await page.goto(`${base}/m/search`);
    await page.getByText("输入订单、申请人、项目、代理、流程、收付款或材料信息开始搜索。").waitFor();
    assert.equal(searchRequests, 0, "empty mobile search must not call the business search API");
    await page.getByRole("textbox", { name: "全局搜索关键词" }).fill("申请人+金额");
    await page.getByText("护照首页").waitFor();
    await page.getByRole("button", { name: "继续查看" }).click();
    await page.getByText("手机测试项目 2 · 申请人 2").waitFor();
    assert.equal(await page.getByText("手机测试项目 1 · 申请人 1").count(), 1, "pagination must deduplicate");
    await page.getByText("手机测试项目 1 · 申请人 1").click();
    await page.waitForURL(/tab=people&from=search$/);
    await page.getByText("护照首页").waitFor();
    assert.equal(await page.getByRole("link", { name: "申请人与材料" }).getAttribute("aria-current"), "page");
    await page.goBack();
    await page.getByText("护照首页").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "全局搜索关键词" }).inputValue(), "申请人+金额");
    await page.getByText("示例项目", { exact: true }).click();
    await page.waitForURL(/\/m\/orders\?.*projectId=project-1/);
    await page.getByText("关联订单 · 示例项目").waitFor();
    await page.goBack();
    await page.getByText("护照首页").waitFor();
    await page.getByText("手机测试项目 1 · 申请人 1").click();
    await page.waitForURL(/tab=people&from=search$/);
    console.log("PASS mobile grouped search, deduplication and module target");

    await page.goto(`${base}/m/orders/${orderNo}?tab=workflow`);
    await page.getByRole("button", { name: "完成步骤" }).click();
    await page.getByRole("dialog", { name: "完成当前步骤" }).getByRole("button", { name: "确认完成" }).click();
    await page.getByText("递交申请", { exact: true }).first().waitFor();
    await page.getByText("进行中 · 预计 2026-10-10", { exact: true }).first().waitFor();
    assert.deepEqual(mutations[0], { action: "step", stepId: "step-1", status: "COMPLETED", expectedVersion: 1 });
    await page.getByRole("button", { name: "新增跟进" }).click();
    await page.getByRole("textbox", { name: "本次跟进内容" }).fill("已联系申请人");
    await page.getByRole("textbox", { name: "详细说明（可选）" }).fill("约定周五补件");
    await page.getByRole("textbox", { name: "下一步事项（可选）" }).fill("确认材料");
    assert.equal(await page.getByRole("button", { name: "保存跟进" }).isDisabled(), true, "next action requires a date");
    await page.getByLabel("跟进日期（与下一步同时填写）").fill("2026-10-11");
    await page.getByRole("button", { name: "保存跟进" }).click();
    await page.getByText("跟进记录 · 本页 1 条").waitFor();
    await page.getByText("跟进记录 · 本页 1 条").click();
    await page.getByText("约定周五补件").waitFor();
    assert.equal(mutations[1].action, "progress");
    assert.equal(mutations[1].expectedVersion, 2);
    assert.equal(mutations[1].nextAction, "确认材料");
    assert.equal(mutations[1].followUpDate, "2026-10-11");
    conflictNext = true;
    await page.getByRole("button", { name: "新增跟进" }).click();
    await page.getByRole("textbox", { name: "本次跟进内容" }).fill("冲突测试");
    await page.getByRole("button", { name: "保存跟进" }).click();
    await page.getByText("订单已被修改，正在刷新。请核对最新内容后再操作。").waitFor();
    assert.equal(mutations.length, 3, "conflicted write must not be retried automatically");
    assert.equal(await page.getByRole("button", { name: "保存跟进" }).isDisabled(), true);
    await page.getByRole("button", { name: "已核对订单，继续操作" }).click();
    assert.equal(await page.getByRole("button", { name: "保存跟进" }).isEnabled(), true);
    console.log("PASS mobile workflow actions, validation and conflict refresh");

    await page.goto(`${base}/m/orders/${orderNo}?tab=finance`);
    await page.getByRole("heading", { name: "收付款计划" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
      "finance detail should not overflow horizontally");
    if (screenshotDir)
      await page.screenshot({ path: `${screenshotDir}/detail-finance.png`, fullPage: true });
    await page.getByRole("button", { name: "登记收款" }).click();
    const mobileCashDialog = page.getByRole("dialog", { name: "登记收款" });
    await page.waitForTimeout(300);
    const mobileCashBox = await mobileCashDialog.boundingBox();
    assert.ok(mobileCashBox && Math.abs(mobileCashBox.width - viewportWidth) < 1 && Math.abs(mobileCashBox.height - 844) < 1,
      "mobile cash form should use the full viewport");
    if (screenshotDir)
      await page.screenshot({ path: `${screenshotDir}/cash-form.png`, fullPage: true });
    await page.getByLabel("关联计划（可选）").selectOption("plan-1");
    assert.equal(await page.getByLabel("收款说明").inputValue(), "首付款");
    await page.getByLabel("实际币种").selectOption("CNY");
    await page.getByText("调整本位币金额与汇率").click();
    await page.getByLabel("原币金额（CNY）").fill("750");
    assert.equal(await page.getByLabel("本位币金额（USD） · 自动算出").inputValue(), "100.00");
    await page.getByLabel("本位币金额（USD） · 自动算出").fill("125");
    assert.equal(await page.getByLabel("汇率（1 USD = ? CNY） · 自动算出").inputValue(), "6");
    await page.getByLabel("汇率（1 USD = ? CNY） · 自动算出").fill("7.5");
    assert.equal(await page.getByLabel("原币金额（CNY） · 自动算出").inputValue(), "937.50");
    await page.getByLabel("原币金额（CNY） · 自动算出").fill("750");
    assert.equal(await page.getByLabel("本位币金额（USD） · 自动算出").inputValue(), "100.00");
    await page.getByRole("button", { name: "保存收款" }).click();
    await page.getByText("收款 · 首付款").waitFor();
    const receipt = mutations[3];
    assert.equal(receipt.action, "saveCashEntry");
    assert.equal(receipt.direction, "RECEIPT");
    assert.equal(receipt.currency, "CNY");
    assert.equal(receipt.orderPlanId, "plan-1");
    assert.equal(receipt.baseAmount, "100.00");
    assert.equal(receipt.expectedVersion, 4);
    await page.getByRole("button", { name: "登记付款" }).click();
    await page.getByLabel("关联计划（可选）").selectOption("plan-2");
    await page.getByText("调整本位币金额与汇率").click();
    await page.getByLabel("原币金额（CNY）").fill("750");
    await page.getByLabel("本位币金额（USD） · 自动算出").fill("100");
    assert.equal(await page.getByLabel("汇率（1 USD = ? CNY） · 自动算出").inputValue(), "7.5");
    await page.getByRole("button", { name: "保存付款" }).click();
    await page.getByText("付款 · 项目服务费").waitFor();
    assert.equal(mutations[4].direction, "PAYMENT");
    assert.equal(mutations[4].calculatedField, "ratePerUsd");
    assert.equal(mutations[4].ratePerUsd, "7.5");
    assert.equal(mutations[4].expectedVersion, 5);
    assert.equal(await page.getByText("已结清").count(), 1);
    console.log("PASS mobile separate receipt and payment with shared multi-currency calculation");

    await page.goto(`${base}/m/orders/${orderNo}?tab=people`);
    await page.getByText("护照首页").waitFor();
    await page.getByRole("button", { name: "申请人 1 护照首页 上传材料" }).click();
    if (screenshotDir) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${screenshotDir}/material-upload-sheet.png`, fullPage: true });
    }
    await page.getByLabel("申请人 1 护照首页 选择文件上传").setInputFiles({ name: "passport.jpg", mimeType: "image/jpeg", buffer: Buffer.from("mock-passport-image") });
    const review = page.getByRole("dialog", { name: "核对护照识别结果" });
    await review.waitFor();
    await page.waitForTimeout(300);
    const reviewBox = await review.boundingBox();
    assert.ok(reviewBox && Math.abs(reviewBox.width - viewportWidth) < 1 && Math.abs(reviewBox.height - 844) < 1,
      "mobile MRZ review should use the full viewport");
    if (screenshotDir)
      await page.screenshot({ path: `${screenshotDir}/mrz-review.png`, fullPage: true });
    assert.equal(scanCount, 1);
    assert.equal(await review.getByLabel("护照号码").inputValue(), "L898902C3");
    assert.equal(await review.getByLabel("系统显示姓名").inputValue(), "申请人 1", "existing display name must not be overwritten without confirmation");
    assert.equal(await review.getByRole("button", { name: "确认并登记" }).isDisabled(), true);
    await review.getByLabel("国籍").fill("UTO");
    await review.getByLabel("我已对照护照原件逐项核对上述资料").check();
    await review.getByRole("button", { name: "确认并登记" }).click();
    await review.waitFor({ state: "hidden" });
    assert.equal(mutations.at(-1).action, "confirmMrz");
    assert.equal(mutations.at(-1).materialFileId, "file-1");
    assert.equal(mutations.at(-1).expectedVersion, 6);
    await page.getByRole("button", { name: "预览" }).click();
    await page.getByRole("dialog", { name: "护照首页.jpg" }).waitFor();
    assert.equal(await page.getByRole("link", { name: /下载/ }).count(), 0);
    await page.getByRole("dialog", { name: "护照首页.jpg" }).getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "识别" }).click();
    await review.waitFor();
    assert.equal(scanCount, 2, "existing passport can be rescanned through the preview endpoint");
    await review.getByRole("button", { name: "Close" }).click();
    await page.getByRole("link", { name: "合同与付款" }).click();
    await page.getByText("正在读取当前模块…").waitFor();
    assert.equal(await page.getByText("护照首页").count(), 0, "old applicant materials must not appear in the common-files module");
    await page.getByText("服务合同").waitFor();
    await page.getByRole("button", { name: "合同与付款 服务合同 上传材料" }).click();
    await page.getByLabel("合同与付款 服务合同 选择文件上传").setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nmock\n") });
    await page.getByText("已上传 1 个文件").waitFor();
    assert.equal(fileRequests.length, 2);
    assert.equal(scanCount, 2, "non-passport files must not invoke MRZ");
    console.log("PASS mobile materials upload, preview, rescan, human MRZ confirmation and common files");

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile layout should not overflow horizontally");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/`);
    await page.getByRole("link", { name: "手机版" }).click();
    await page.waitForURL(`${base}/m`);
    assert.deepEqual(pageErrors, []);
    console.log("PASS mobile viewport, desktop switch and no runtime errors");

    await page.goto(`${base}/orders/${orderNo}?tab=finance`);
    await page.getByRole("button", { name: "登记收款" }).first().click();
    const desktopCash = page.getByRole("dialog", { name: "登记收款" });
    await desktopCash.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: /CNY/ }).click();
    await desktopCash.getByLabel("原币金额（CNY）").fill("750");
    assert.equal(await desktopCash.getByLabel("本位币金额（USD）").inputValue(), "100.00");
    await desktopCash.getByLabel("本位币金额（USD）").fill("125");
    assert.equal(await desktopCash.getByLabel("汇率（1 USD = ? CNY）").inputValue(), "6");
    await desktopCash.getByLabel("汇率（1 USD = ? CNY）").fill("7.5");
    assert.equal(await desktopCash.getByLabel("原币金额（CNY）").inputValue(), "937.50");
    assert.equal(await desktopCash.getByText("改为自动计算").count(), 0);
    assert.deepEqual(pageErrors, []);
    console.log("PASS desktop receipt infers the third cash value without a manual switch");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

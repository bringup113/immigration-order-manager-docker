import { newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";
import {
  DomainError,
  generatedCode,
  normalizeCurrency,
  rateToScaled,
  requireActiveCurrency,
  textValue,
  type JsonRecord,
} from "@/lib/domain";

export type ResourceMutationResult = {
  body: Record<string, unknown>;
  status?: number;
};

export async function mutateAgent(
  db: AppDatabase,
  body: JsonRecord,
): Promise<ResourceMutationResult> {
  const action = textValue(body, "action") || "create";
  const name = textValue(body, "name");
  const now = nowIso();
  if (action === "activate" || action === "deactivate") {
    const id = textValue(body, "id");
    const existing = id
      ? await db
          .prepare("SELECT id,name,system_managed FROM agents WHERE id=?")
          .bind(id)
          .first()
      : null;
    if (!existing) throw new DomainError("代理不存在。", 404);
    if (Boolean(existing.system_managed))
      throw new DomainError("系统内置的“公司直营”必须保持启用。", 409);
    await db
      .prepare("UPDATE agents SET active=?,updated_at=? WHERE id=?")
      .bind(action === "activate" ? 1 : 0, now, id)
      .run();
    return { body: { id, active: action === "activate" } };
  }
  if (!name) throw new DomainError("请填写代理名称。");
  if (action === "update") {
    const id = textValue(body, "id");
    const existing = id
      ? await db
          .prepare("SELECT id,system_managed FROM agents WHERE id=?")
          .bind(id)
          .first()
      : null;
    if (!existing) throw new DomainError("代理不存在。", 404);
    if (Boolean(existing.system_managed))
      throw new DomainError("系统内置的“公司直营”不能修改。", 409);
    await db
      .prepare(
        "UPDATE agents SET name=?,contact_name=?,phone=?,email=?,country_region=?,notes=?,updated_at=? WHERE id=?",
      )
      .bind(
        name,
        textValue(body, "contactName") || null,
        textValue(body, "phone") || null,
        textValue(body, "email") || null,
        textValue(body, "countryRegion") || null,
        textValue(body, "notes") || null,
        now,
        id,
      )
      .run();
    return { body: { id } };
  }
  if (action !== "create") throw new DomainError("不支持该代理操作。");
  const id = newId("agt");
  await db
    .prepare(
      "INSERT INTO agents (id,code,name,contact_name,phone,email,country_region,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)",
    )
    .bind(
      id,
      generatedCode("AGT"),
      name,
      textValue(body, "contactName") || null,
      textValue(body, "phone") || null,
      textValue(body, "email") || null,
      textValue(body, "countryRegion") || null,
      textValue(body, "notes") || null,
      now,
      now,
    )
    .run();
  return { body: { id }, status: 201 };
}

export async function mutateChannel(
  db: AppDatabase,
  body: JsonRecord,
): Promise<ResourceMutationResult> {
  const action = textValue(body, "action") || "create";
  const name = textValue(body, "name");
  const now = nowIso();
  if (action === "activate" || action === "deactivate") {
    const id = textValue(body, "id");
    const existing = id
      ? await db
          .prepare("SELECT id,name FROM channels WHERE id=?")
          .bind(id)
          .first()
      : null;
    if (!existing) throw new DomainError("渠道商不存在。", 404);
    if (action === "deactivate") {
      const defaults = await db
        .prepare(
          "SELECT COUNT(*) AS value FROM project_channels pc JOIN projects p ON p.id=pc.project_id WHERE pc.channel_id=? AND pc.is_default=1 AND p.status='ACTIVE'",
        )
        .bind(id)
        .first();
      if (Number(defaults?.value || 0) > 0)
        throw new DomainError(
          "该渠道仍是启用项目的默认渠道，请先在项目中更换或清除默认渠道。",
          409,
        );
    }
    await db
      .prepare("UPDATE channels SET active=?,updated_at=? WHERE id=?")
      .bind(action === "activate" ? 1 : 0, now, id)
      .run();
    return { body: { id, active: action === "activate" } };
  }
  if (!name) throw new DomainError("请填写渠道商名称。");
  const settlementCurrency = await requireActiveCurrency(
    db,
    textValue(body, "settlementCurrency") || "USD",
  );
  if (action === "update") {
    const id = textValue(body, "id");
    const existing = id
      ? await db.prepare("SELECT id FROM channels WHERE id=?").bind(id).first()
      : null;
    if (!existing) throw new DomainError("渠道商不存在。", 404);
    await db
      .prepare(
        "UPDATE channels SET name=?,country=?,contact_name=?,phone=?,email=?,settlement_currency=?,notes=?,updated_at=? WHERE id=?",
      )
      .bind(
        name,
        textValue(body, "country") || null,
        textValue(body, "contactName") || null,
        textValue(body, "phone") || null,
        textValue(body, "email") || null,
        settlementCurrency,
        textValue(body, "notes") || null,
        now,
        id,
      )
      .run();
    return { body: { id } };
  }
  if (action !== "create") throw new DomainError("不支持该渠道商操作。");
  const id = newId("chn");
  await db
    .prepare(
      "INSERT INTO channels (id,code,name,country,contact_name,phone,email,settlement_currency,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)",
    )
    .bind(
      id,
      generatedCode("CHN"),
      name,
      textValue(body, "country") || null,
      textValue(body, "contactName") || null,
      textValue(body, "phone") || null,
      textValue(body, "email") || null,
      settlementCurrency,
      textValue(body, "notes") || null,
      now,
      now,
    )
    .run();
  return { body: { id }, status: 201 };
}

export async function mutateCurrency(
  db: AppDatabase,
  body: JsonRecord,
): Promise<ResourceMutationResult> {
  const currency = normalizeCurrency(body.currency);
  const action = textValue(body, "action") || "save";
  if (!/^[A-Z]{3}$/.test(currency))
    throw new DomainError("请填写三位币种代码。");
  const now = nowIso();
  if (action === "deactivate") {
    if (currency === "USD") throw new DomainError("基准币种 USD 不能停用。");
    const usage = await db
      .prepare(
        `SELECT SUM(value) AS value FROM (
          SELECT COUNT(*) AS value FROM channels WHERE active=1 AND settlement_currency=?
          UNION ALL SELECT COUNT(*) FROM projects WHERE status='ACTIVE' AND (default_receivable_currency=? OR provider_currency=?)
          UNION ALL SELECT COUNT(*) FROM project_plan_templates p JOIN projects j ON j.id=p.project_id WHERE j.status='ACTIVE' AND p.currency=?
          UNION ALL SELECT COUNT(*) FROM order_plans p JOIN orders o ON o.id=p.order_id WHERE o.status IN ('DRAFT','ACTIVE','PAUSED') AND p.currency=?
        )`,
      )
      .bind(currency, currency, currency, currency, currency)
      .first();
    if (Number(usage?.value ?? 0) > 0)
      throw new DomainError(
        `币种 ${currency} 仍被启用中的渠道、项目或订单使用，不能停用。`,
      );
    await db
      .prepare(
        "UPDATE exchange_rates SET active=0,updated_at=? WHERE currency=?",
      )
      .bind(now, currency)
      .run();
    return { body: { ok: true } };
  }
  if (action === "activate") {
    const existing = await db
      .prepare("SELECT currency FROM exchange_rates WHERE currency=?")
      .bind(currency)
      .first();
    if (!existing)
      throw new DomainError(`币种 ${currency} 不存在，请先新建。`, 404);
    await db
      .prepare(
        "UPDATE exchange_rates SET active=1,updated_at=? WHERE currency=?",
      )
      .bind(now, currency)
      .run();
    return { body: { ok: true } };
  }
  if (!["save", "create"].includes(action))
    throw new DomainError("不支持该币种操作。");
  const name = textValue(body, "name") || currency;
  const scaled = rateToScaled(body.ratePerUsd);
  if (!scaled) throw new DomainError("请填写三位币种代码和大于 0 的汇率。");
  if (currency === "USD" && scaled !== 100_000_000)
    throw new DomainError("基准币种 USD 的汇率必须保持为 1。");
  if (
    action === "create" &&
    (await db
      .prepare("SELECT currency FROM exchange_rates WHERE currency=?")
      .bind(currency)
      .first())
  )
    throw new DomainError(`币种 ${currency} 已经存在。`, 409);
  await db
    .prepare(
      "INSERT INTO exchange_rates (currency,name,rate_per_usd_scaled,updated_at,active) VALUES (?,?,?,?,1) ON CONFLICT(currency) DO UPDATE SET name=excluded.name,rate_per_usd_scaled=excluded.rate_per_usd_scaled,updated_at=excluded.updated_at,active=1",
    )
    .bind(currency, name, scaled, now)
    .run();
  return { body: { ok: true } };
}

export async function createProjectResource(
  db: AppDatabase,
  body: JsonRecord,
): Promise<ResourceMutationResult> {
  const name = textValue(body, "name");
  const country = textValue(body, "country");
  const code = textValue(body, "code").toUpperCase();
  if (!name || !country || !code)
    throw new DomainError("请填写项目名称、国家和项目简称。");
  if (!/^[A-Z0-9_-]{2,40}$/.test(code))
    throw new DomainError(
      "项目简称只能使用 2–40 位大写字母、数字、下划线或连字符。",
    );
  const [receivableCurrency, providerCurrency] = await Promise.all([
    requireActiveCurrency(db, textValue(body, "receivableCurrency") || "USD"),
    requireActiveCurrency(db, textValue(body, "providerCurrency") || "USD"),
  ]);
  const id = newId("prj");
  const now = nowIso();
  const statements = [
    db
      .prepare(
        "INSERT INTO projects (id,code,name,country,default_receivable_currency,provider_currency,status,revision_no,description,created_at,updated_at) VALUES (?,?,?,?,?,?,'ACTIVE',1,?,?,?)",
      )
      .bind(
        id,
        code,
        name,
        country,
        receivableCurrency,
        providerCurrency,
        textValue(body, "notes") || null,
        now,
        now,
      ),
  ];
  const defaultChannelId = textValue(body, "defaultChannelId");
  if (defaultChannelId)
    statements.push(
      db
        .prepare(
          "INSERT INTO project_channels (id,project_id,channel_id,is_default) VALUES (?,?,?,1)",
        )
        .bind(newId("pch"), id, defaultChannelId),
    );
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique"))
      throw new DomainError("项目简称已经存在，请换一个简称。", 409);
    throw error;
  }
  return { body: { id }, status: 201 };
}

import { z } from "zod";
import { getDatabase, newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";
import { DomainError } from "@/lib/domain";

export const PROJECT_PACKAGE_FORMAT = "migra-project-package";
export const PROJECT_PACKAGE_VERSION = "1.0";
export const PROJECT_PACKAGE_MAX_BYTES = 5 * 1024 * 1024;

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const projectCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/);
const integerText = z.string().regex(/^\d+$/).refine((value) => BigInt(value) <= BigInt("9223372036854775807"), "整数超出数据库范围");

const currencySchema = z.object({
  code: currencyCode,
  name: z.string().trim().min(1).max(200),
  ratePerUsdScaled: integerText.refine((value) => BigInt(value) > BigInt(0), "汇率必须大于 0"),
}).strict();

const channelSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  country: nullableText(120),
  contactName: nullableText(200),
  phone: nullableText(40),
  email: nullableText(254),
  settlementCurrency: currencyCode,
  notes: nullableText(4_000),
  active: z.boolean(),
}).strict();

const stepSchema = z.object({
  name: z.string().trim().min(1).max(200),
  required: z.boolean(),
  dueDays: z.number().int().min(0).max(36_500).nullable(),
  notes: nullableText(4_000),
}).strict();

const planSchema = z.object({
  type: z.enum(["RECEIVABLE", "PAYABLE"]),
  name: z.string().trim().min(1).max(200),
  currency: currencyCode,
  amountMinor: integerText,
  dueDays: z.number().int().min(0).max(36_500).nullable(),
  notes: nullableText(4_000),
}).strict();

const materialSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scope: z.enum(["COMMON", "MAIN", "ALL", "DEPENDENT"]),
  required: z.boolean(),
  notes: nullableText(4_000),
}).strict();

const packagedProjectSchema = z.object({
  code: projectCode,
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().min(1).max(120),
  defaultReceivableCurrency: currencyCode,
  providerCurrency: currencyCode,
  status: z.enum(["ACTIVE", "INACTIVE"]),
  description: nullableText(4_000),
  sourceRevision: z.number().int().positive(),
  channelCodes: z.array(z.string().trim().min(1).max(64)).max(100),
  defaultChannelCode: z.string().trim().min(1).max(64).nullable(),
  steps: z.array(stepSchema).max(300),
  plans: z.array(planSchema).max(300),
  materials: z.array(materialSchema).max(1_000),
}).strict();

const packageSchema = z.object({
  format: z.literal(PROJECT_PACKAGE_FORMAT),
  formatVersion: z.literal(PROJECT_PACKAGE_VERSION),
  appVersion: z.string().trim().max(30),
  exportedAt: z.string().datetime(),
  currencies: z.array(currencySchema).max(100),
  channels: z.array(channelSchema).max(1_000),
  projects: z.array(packagedProjectSchema).min(1).max(500),
}).strict().superRefine((value, context) => {
  const duplicate = (values: string[]) => values.find((item, index) => values.indexOf(item) !== index);
  const duplicateProject = duplicate(value.projects.map((item) => item.code));
  const duplicateChannel = duplicate(value.channels.map((item) => item.code));
  const duplicateCurrency = duplicate(value.currencies.map((item) => item.code));
  if (duplicateProject) context.addIssue({ code: "custom", message: `项目简称 ${duplicateProject} 重复。` });
  if (duplicateChannel) context.addIssue({ code: "custom", message: `渠道代码 ${duplicateChannel} 重复。` });
  if (duplicateCurrency) context.addIssue({ code: "custom", message: `币种 ${duplicateCurrency} 重复。` });
  const channelCodes = new Set(value.channels.map((item) => item.code));
  const currencyCodes = new Set(value.currencies.map((item) => item.code));
  for (const project of value.projects) {
    const duplicateLink = duplicate(project.channelCodes);
    if (duplicateLink) context.addIssue({ code: "custom", message: `项目 ${project.code} 重复关联渠道 ${duplicateLink}。` });
    if (project.defaultChannelCode && !project.channelCodes.includes(project.defaultChannelCode)) context.addIssue({ code: "custom", message: `项目 ${project.code} 的默认渠道不在关联渠道中。` });
    for (const code of project.channelCodes) if (!channelCodes.has(code)) context.addIssue({ code: "custom", message: `项目 ${project.code} 引用了包内不存在的渠道 ${code}。` });
    for (const code of [project.defaultReceivableCurrency, project.providerCurrency, ...project.plans.map((item) => item.currency)]) {
      if (!currencyCodes.has(code)) context.addIssue({ code: "custom", message: `项目 ${project.code} 引用了包内不存在的币种 ${code}。` });
    }
  }
  for (const channel of value.channels) if (!currencyCodes.has(channel.settlementCurrency)) context.addIssue({ code: "custom", message: `渠道 ${channel.code} 引用了包内不存在的币种 ${channel.settlementCurrency}。` });
});

export type ProjectPackage = z.infer<typeof packageSchema>;
export type ProjectConflictAction = "OVERWRITE" | "COPY";

export function parseProjectPackage(value: unknown) {
  const parsed = packageSchema.safeParse(value);
  if (!parsed.success) throw new DomainError(`项目包格式不正确：${parsed.error.issues[0]?.message || "无法读取"}`);
  return parsed.data;
}

function boolean(value: unknown) { return Number(value) === 1; }
function nullableNumber(value: unknown) { return value === null || value === undefined ? null : Number(value); }

export async function exportProjectPackage(projectId?: string, db: AppDatabase = getDatabase()): Promise<ProjectPackage> {
  const projects = projectId
    ? await db.prepare("SELECT * FROM projects WHERE id=? ORDER BY created_at,id").bind(projectId).all()
    : await db.prepare("SELECT * FROM projects ORDER BY created_at,id").all();
  if (!projects.results.length) throw new DomainError(projectId ? "项目不存在。" : "当前没有可导出的项目。", 404);
  const packagedProjects: ProjectPackage["projects"] = [];
  const channels = new Map<string, ProjectPackage["channels"][number]>();
  const usedCurrencies = new Set<string>();

  for (const project of projects.results) {
    const id = String(project.id);
    const [steps, plans, materials, linkedChannels] = await Promise.all([
      db.prepare("SELECT * FROM project_step_templates WHERE project_id=? ORDER BY sequence,id").bind(id).all(),
      db.prepare("SELECT * FROM project_plan_templates WHERE project_id=? ORDER BY CASE plan_type WHEN 'RECEIVABLE' THEN 1 ELSE 2 END,sequence,id").bind(id).all(),
      db.prepare("SELECT * FROM project_material_templates WHERE project_id=? ORDER BY sequence,id").bind(id).all(),
      db.prepare(`SELECT c.*,pc.is_default FROM project_channels pc JOIN channels c ON c.id=pc.channel_id
        WHERE pc.project_id=? ORDER BY pc.is_default DESC,c.code`).bind(id).all(),
    ]);
    for (const row of linkedChannels.results) {
      const code = String(row.code);
      channels.set(code, { code, name: String(row.name), country: row.country ? String(row.country) : null,
        contactName: row.contact_name ? String(row.contact_name) : null, phone: row.phone ? String(row.phone) : null,
        email: row.email ? String(row.email) : null, settlementCurrency: String(row.settlement_currency),
        notes: row.notes ? String(row.notes) : null, active: boolean(row.active) });
      usedCurrencies.add(String(row.settlement_currency));
    }
    const projectPlans = plans.results.map((row) => ({ type: String(row.plan_type) as "RECEIVABLE" | "PAYABLE", name: String(row.name),
      currency: String(row.currency), amountMinor: String(row.amount_minor), dueDays: nullableNumber(row.due_days), notes: row.notes ? String(row.notes) : null }));
    usedCurrencies.add(String(project.default_receivable_currency));
    usedCurrencies.add(String(project.provider_currency));
    for (const plan of projectPlans) usedCurrencies.add(plan.currency);
    const defaultChannel = linkedChannels.results.find((row) => boolean(row.is_default));
    packagedProjects.push({ code: String(project.code), name: String(project.name), country: String(project.country),
      defaultReceivableCurrency: String(project.default_receivable_currency), providerCurrency: String(project.provider_currency),
      status: String(project.status) as "ACTIVE" | "INACTIVE", description: project.description ? String(project.description) : null,
      sourceRevision: Number(project.revision_no), channelCodes: linkedChannels.results.map((row) => String(row.code)),
      defaultChannelCode: defaultChannel ? String(defaultChannel.code) : null,
      steps: steps.results.map((row) => ({ name: String(row.name), required: boolean(row.required), dueDays: nullableNumber(row.due_days), notes: row.notes ? String(row.notes) : null })),
      plans: projectPlans,
      materials: materials.results.map((row) => ({ name: String(row.name), scope: String(row.scope) as "COMMON" | "MAIN" | "ALL" | "DEPENDENT", required: boolean(row.required), notes: row.notes ? String(row.notes) : null })),
    });
  }

  const currencies: ProjectPackage["currencies"] = [];
  for (const code of [...usedCurrencies].sort()) {
    const row = await db.prepare("SELECT currency,name,rate_per_usd_scaled FROM exchange_rates WHERE currency=?").bind(code).first();
    if (!row) throw new DomainError(`项目引用的币种 ${code} 已不存在，无法导出。`, 409);
    currencies.push({ code, name: String(row.name), ratePerUsdScaled: String(row.rate_per_usd_scaled) });
  }
  return { format: PROJECT_PACKAGE_FORMAT, formatVersion: PROJECT_PACKAGE_VERSION, appVersion: "1.0", exportedAt: new Date().toISOString(), currencies, channels: [...channels.values()].sort((a, b) => a.code.localeCompare(b.code)), projects: packagedProjects };
}

export type ProjectPackagePreview = {
  summary: { projects: number; steps: number; plans: number; materials: number; channels: number; currencies: number };
  projects: { code: string; name: string; exists: boolean; counts: { steps: number; plans: number; materials: number; channels: number } }[];
  dependencies: { missingChannels: string[]; reusedChannels: string[]; missingCurrencies: string[]; reusedCurrencies: string[] };
};

export async function previewProjectPackage(bundle: ProjectPackage, db: AppDatabase = getDatabase()): Promise<ProjectPackagePreview> {
  const projectRows = await db.prepare("SELECT code FROM projects").all();
  const channelRows = await db.prepare("SELECT code FROM channels").all();
  const currencyRows = await db.prepare("SELECT currency FROM exchange_rates").all();
  const projectCodes = new Set(projectRows.results.map((row) => String(row.code)));
  const channelCodes = new Set(channelRows.results.map((row) => String(row.code)));
  const currencyCodes = new Set(currencyRows.results.map((row) => String(row.currency)));
  return {
    summary: { projects: bundle.projects.length, steps: bundle.projects.reduce((sum, item) => sum + item.steps.length, 0),
      plans: bundle.projects.reduce((sum, item) => sum + item.plans.length, 0), materials: bundle.projects.reduce((sum, item) => sum + item.materials.length, 0),
      channels: bundle.channels.length, currencies: bundle.currencies.length },
    projects: bundle.projects.map((item) => ({ code: item.code, name: item.name, exists: projectCodes.has(item.code), counts: { steps: item.steps.length, plans: item.plans.length, materials: item.materials.length, channels: item.channelCodes.length } })),
    dependencies: { missingChannels: bundle.channels.filter((item) => !channelCodes.has(item.code)).map((item) => item.code),
      reusedChannels: bundle.channels.filter((item) => channelCodes.has(item.code)).map((item) => item.code),
      missingCurrencies: bundle.currencies.filter((item) => !currencyCodes.has(item.code)).map((item) => item.code),
      reusedCurrencies: bundle.currencies.filter((item) => currencyCodes.has(item.code)).map((item) => item.code) },
  };
}

export async function importProjectPackage(
  bundle: ProjectPackage,
  conflicts: Record<string, ProjectConflictAction>,
  copyCodes: Record<string, string>,
  onImported?: (result: { preview: ProjectPackagePreview; imported: { sourceCode: string; targetCode: string; action: "CREATE" | ProjectConflictAction; projectId: string }[] }, tx: AppDatabase) => Promise<void>,
  db: AppDatabase = getDatabase(),
) {
  return db.transaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('migra_project_package_import'))").first();
    const preview = await previewProjectPackage(bundle, tx);
    const usedTargetCodes = new Set<string>();
    for (const project of preview.projects) {
      const action = project.exists ? conflicts[project.code] : undefined;
      if (project.exists && action !== "OVERWRITE" && action !== "COPY") throw new DomainError(`请选择项目 ${project.code} 的冲突处理方式。`);
      const targetCode = action === "COPY" ? String(copyCodes[project.code] || "").trim().toUpperCase() : project.code;
      if (!/^[A-Z0-9_-]{2,40}$/.test(targetCode)) throw new DomainError(`项目 ${project.code} 的新简称格式不正确。`);
      if (usedTargetCodes.has(targetCode)) throw new DomainError(`导入后的项目简称 ${targetCode} 重复。`);
      usedTargetCodes.add(targetCode);
      if (action === "COPY" && await tx.prepare("SELECT 1 FROM projects WHERE code=?").bind(targetCode).first()) throw new DomainError(`项目简称 ${targetCode} 已经存在。`, 409);
    }

    const now = nowIso();
    for (const currency of bundle.currencies) {
      await tx.prepare(`INSERT INTO exchange_rates(currency,name,rate_per_usd_scaled,updated_at,active) VALUES (?,?,?,?,1)
        ON CONFLICT(currency) DO NOTHING`).bind(currency.code, currency.name, currency.ratePerUsdScaled, now).run();
    }
    for (const channel of bundle.channels) {
      await tx.prepare(`INSERT INTO channels(id,code,name,country,contact_name,phone,email,settlement_currency,notes,active,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(code) DO NOTHING`)
        .bind(newId("chn"), channel.code, channel.name, channel.country, channel.contactName, channel.phone, channel.email,
          channel.settlementCurrency, channel.notes, channel.active ? 1 : 0, now, now).run();
    }
    const channelRows = await tx.prepare("SELECT id,code FROM channels").all();
    const channelIds = new Map(channelRows.results.map((row) => [String(row.code), String(row.id)]));
    const imported: { sourceCode: string; targetCode: string; action: "CREATE" | ProjectConflictAction; projectId: string }[] = [];

    for (const project of bundle.projects) {
      const existing = await tx.prepare("SELECT id FROM projects WHERE code=? FOR UPDATE").bind(project.code).first();
      const action: "CREATE" | ProjectConflictAction = existing ? conflicts[project.code] : "CREATE";
      const targetCode = action === "COPY" ? copyCodes[project.code].trim().toUpperCase() : project.code;
      const projectId = action === "OVERWRITE" ? String(existing?.id) : newId("prj");
      if (action === "OVERWRITE") {
        await tx.batch([
          tx.prepare(`UPDATE projects SET name=?,country=?,default_receivable_currency=?,provider_currency=?,status=?,description=?,
            revision_no=revision_no+1,version=version+1,updated_at=? WHERE id=?`)
            .bind(project.name, project.country, project.defaultReceivableCurrency, project.providerCurrency, project.status, project.description, now, projectId),
          tx.prepare("DELETE FROM project_channels WHERE project_id=?").bind(projectId),
          tx.prepare("DELETE FROM project_step_templates WHERE project_id=?").bind(projectId),
          tx.prepare("DELETE FROM project_plan_templates WHERE project_id=?").bind(projectId),
          tx.prepare("DELETE FROM project_material_templates WHERE project_id=?").bind(projectId),
        ]);
      } else {
        await tx.prepare(`INSERT INTO projects(id,code,name,country,default_receivable_currency,provider_currency,status,revision_no,version,description,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,1,1,?,?,?)`).bind(projectId, targetCode, project.name, project.country, project.defaultReceivableCurrency,
          project.providerCurrency, project.status, project.description, now, now).run();
      }
      const planSequences = new Map<string, number>();
      const statements = [
        ...project.channelCodes.map((code) => tx.prepare("INSERT INTO project_channels(id,project_id,channel_id,is_default) VALUES (?,?,?,?)")
          .bind(newId("pch"), projectId, channelIds.get(code), project.defaultChannelCode === code ? 1 : 0)),
        ...project.steps.map((item, index) => tx.prepare("INSERT INTO project_step_templates(id,project_id,name,sequence,required,due_days,notes) VALUES (?,?,?,?,?,?,?)")
          .bind(newId("pst"), projectId, item.name, index + 1, item.required ? 1 : 0, item.dueDays, item.notes)),
        ...project.plans.map((item) => {
          const sequence = (planSequences.get(item.type) || 0) + 1;
          planSequences.set(item.type, sequence);
          return tx.prepare("INSERT INTO project_plan_templates(id,project_id,plan_type,sequence,name,currency,amount_minor,due_days,channel_id,notes) VALUES (?,?,?,?,?,?,?,?,NULL,?)")
            .bind(newId("ppt"), projectId, item.type, sequence, item.name, item.currency, item.amountMinor, item.dueDays, item.notes);
        }),
        ...project.materials.map((item, index) => tx.prepare("INSERT INTO project_material_templates(id,project_id,name,scope,required,sequence,notes) VALUES (?,?,?,?,?,?,?)")
          .bind(newId("pmt"), projectId, item.name, item.scope, item.required ? 1 : 0, index, item.notes)),
      ];
      if (statements.length) await tx.batch(statements);
      imported.push({ sourceCode: project.code, targetCode, action, projectId });
    }
    const result = { preview, imported };
    if (onImported) await onImported(result, tx);
    return result;
  });
}

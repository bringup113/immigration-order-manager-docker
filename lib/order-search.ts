import { pinyin } from "pinyin-pro";
import type { AppDatabase } from "@/db/driver";
import { nowIso } from "@/db/database";
import type { GlobalSearchOrder, OrderDetailTab } from "@/lib/api-contracts";
import { normalizeOrderDetailTab } from "@/lib/order-navigation";

type Row = Record<string, unknown>;
type SearchSource = { label: string; text: string; tab: OrderDetailTab; domain: "order" | "finance" | "materials" | "tasks"; search: string };

function compact(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s,，]+/g, "");
}

function pinyinValues(value: string) {
  if (!/[\u3400-\u9fff]/u.test(value)) return { full: "", initials: "" };
  const options = { toneType: "none" as const, separator: "", nonZh: "consecutive" as const };
  const common = pinyin(value, options);
  const surname = pinyin(value, { ...options, mode: "surname", surname: "head" });
  const initials = pinyin(value, { ...options, pattern: "first" });
  const surnameInitials = pinyin(value, { ...options, pattern: "first", mode: "surname", surname: "head" });
  return { full: `${common} ${surname}`, initials: `${initials} ${surnameInitials}` };
}

function amountText(amountMinor: unknown, currency: unknown) {
  const amount = Number(amountMinor);
  if (!Number.isFinite(amount)) return "";
  const fixed = (amount / 100).toFixed(2);
  const simple = fixed.replace(/\.00$/, "");
  const code = String(currency ?? "").toUpperCase();
  return `${fixed} ${simple} ${code}${fixed} ${code}${simple}`;
}

function source(label: string, values: unknown[], tab: OrderDetailTab, domain: SearchSource["domain"] = "order"): SearchSource {
  const text = values.filter((value) => value !== null && value !== undefined && String(value).trim()).join(" · ");
  const py = pinyinValues(text);
  return { label, text, tab, domain, search: compact(`${text} ${py.full} ${py.initials}`) };
}

export async function rebuildOrder(db: AppDatabase, orderId: string, sourceVersion: string) {
  const [order, applicants, steps, plans, cash, materials, files, progress, tasks] = await Promise.all([
    db.prepare(`SELECT o.*,c.name AS agent_name,c.contact_name,c.phone,c.email,c.country_region,c.notes AS agent_notes,u.display_name AS owner_name,u.username AS owner_username
      FROM orders o JOIN agents c ON c.id=o.agent_id JOIN users u ON u.id=o.owner_user_id WHERE o.id=?`).bind(orderId).first(),
    db.prepare("SELECT * FROM order_applicants WHERE order_id=? ORDER BY sequence").bind(orderId).all(),
    db.prepare("SELECT * FROM order_steps WHERE order_id=? ORDER BY sequence").bind(orderId).all(),
    db.prepare(`SELECT p.*,c.name AS channel_name FROM order_plans p LEFT JOIN channels c ON c.id=p.channel_id
      WHERE p.order_id=? ORDER BY p.plan_type,p.sequence`).bind(orderId).all(),
    db.prepare("SELECT * FROM order_cash_entries WHERE order_id=? ORDER BY entry_date,created_at").bind(orderId).all(),
    db.prepare(`SELECT m.*,a.name AS applicant_name FROM order_materials m LEFT JOIN order_applicants a ON a.id=m.applicant_id
      WHERE m.order_id=? ORDER BY m.applicant_id,m.sequence`).bind(orderId).all(),
    db.prepare(`SELECT f.*,m.name AS material_name,a.name AS applicant_name FROM material_files f
      JOIN order_materials m ON m.id=f.material_id LEFT JOIN order_applicants a ON a.id=m.applicant_id
      WHERE f.order_id=? ORDER BY f.uploaded_at`).bind(orderId).all(),
    db.prepare("SELECT * FROM order_progress WHERE order_id=? ORDER BY progress_date,created_at").bind(orderId).all(),
    db.prepare("SELECT t.*,u.display_name AS task_owner_name,u.username AS task_owner_username FROM order_tasks t JOIN users u ON u.id=t.owner_user_id WHERE t.order_id=? ORDER BY t.due_date,t.created_at").bind(orderId).all(),
  ]);
  if (!order) { await db.prepare("DELETE FROM order_search_index WHERE order_id=?").bind(orderId).run(); return; }

  const sources: SearchSource[] = [
    source("订单", [order.order_no, order.status, order.notes, order.signed_at, order.owner_name, order.owner_username, order.status_reason, order.closed_on, order.closure_result, order.closure_notes], "common"),
    source("代理", [order.agent_name, order.contact_name, order.phone, order.email, order.country_region, order.agent_notes], "workflow"),
    source("项目", [order.project_code_snapshot, order.project_name_snapshot, order.country_snapshot, order.project_revision], "workflow"),
    ...applicants.results.map((row: Row) => source(`申请人：${row.name}`, [row.name, row.surname, row.given_names, row.nationality, row.passport_no, row.birth_date, row.sex, row.passport_expiry, row.issuing_country, row.document_code, row.personal_number, row.relationship, row.applicant_type], "people")),
    ...steps.results.map((row: Row) => source(`办理流程：${row.name}`, [row.name, row.status, row.due_date, row.notes], "workflow")),
    ...plans.results.map((row: Row) => source(`收付款计划：${row.name}`, [row.name, row.plan_type, row.currency, amountText(row.planned_amount_minor, row.currency), amountText(row.planned_base_minor, "USD"), row.due_date, row.channel_name, row.notes], "finance", "finance")),
    ...cash.results.map((row: Row) => { const state = row.status === "VOIDED" ? "已作废" : "有效"; return source(`${state}${row.direction === "RECEIPT" ? "收款" : "付款"}：${row.description}`, [state, row.status, row.description, row.direction, row.currency, amountText(row.amount_minor, row.currency), amountText(row.base_amount_minor, "USD"), row.entry_date, row.notes, row.void_reason], "finance", "finance"); }),
    ...materials.results.map((row: Row) => source(`材料：${row.name}`, [row.name, row.applicant_name || "合同与付款", row.expected_date, row.notes], row.applicant_id ? "people" : "common", "materials")),
    ...files.results.map((row: Row) => source(`文件：${row.stored_name}`, [row.stored_name, row.original_name, row.material_name, row.applicant_name || "合同与付款", row.mime_type, row.uploaded_at, row.status, row.status_reason], row.applicant_name ? "people" : "common", "materials")),
    ...progress.results.map((row: Row) => source(`跟进：${row.title}`, [row.title, row.details, row.next_action, row.progress_date, row.follow_up_date], "workflow")),
    ...tasks.results.map((row: Row) => source(`待办：${row.title}`, [row.title, row.due_date, row.priority, row.status, row.task_owner_name, row.task_owner_username], "workflow", "tasks")),
  ].filter((item) => item.text);

  const text = sources.map((item) => item.text).join("\n");
  const py = { full: "", initials: "" }; // Each source already contains its phonetic forms.
  const searchBlob = compact(`${text} ${py.full} ${py.initials} ${sources.map((item) => item.search).join(" ")}`);
  const domainBlob = (domain: SearchSource["domain"]) => compact(sources.filter((item) => item.domain === domain).map((item) => item.search).join(" "));
  const mainApplicant = applicants.results.find((row: Row) => row.applicant_type === "MAIN")?.name ?? null;
  const now = nowIso();
  await db.prepare(`INSERT INTO order_search_index
    (order_id,order_no,agent_name,project_name,main_applicant,source_version,search_text,search_pinyin,search_initials,search_blob,search_order_blob,search_finance_blob,search_material_blob,search_task_blob,match_details,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET
    order_no=excluded.order_no,agent_name=excluded.agent_name,project_name=excluded.project_name,main_applicant=excluded.main_applicant,
    source_version=excluded.source_version,search_text=excluded.search_text,search_pinyin=excluded.search_pinyin,
    search_initials=excluded.search_initials,search_blob=excluded.search_blob,search_order_blob=excluded.search_order_blob,
    search_finance_blob=excluded.search_finance_blob,search_material_blob=excluded.search_material_blob,search_task_blob=excluded.search_task_blob,match_details=excluded.match_details,updated_at=excluded.updated_at`)
    .bind(orderId, order.order_no, order.agent_name, order.project_name_snapshot, mainApplicant, sourceVersion, text, py.full, py.initials, searchBlob,
      domainBlob("order"), domainBlob("finance"), domainBlob("materials"), domainBlob("tasks"), JSON.stringify(sources), now).run();
}

export function searchTerms(query: string) {
  return query.split(/[+＋]/u).map(compact).filter(Boolean).slice(0, 8);
}

export function matchesAll(value: string, terms: string[]) {
  const py = pinyinValues(value);
  const searchable = compact(`${value} ${py.full} ${py.initials}`);
  return terms.every((term) => searchable.includes(term));
}

export function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function rebuildEntity(db: AppDatabase, kind: string, id: string) {
  const row = await db.prepare(kind === "agent"
    ? "SELECT name,contact_name,phone,email,country_region,notes FROM agents WHERE id=?"
    : "SELECT code,name,country,description FROM projects WHERE id=?").bind(id).first();
  if (!row) {
    await db.prepare("DELETE FROM entity_search_index WHERE entity_type=? AND entity_id=?").bind(kind, id).run();
    return;
  }
  const value = Object.values(row).join(" ");
  const py = pinyinValues(value);
  await db.prepare(`INSERT INTO entity_search_index(entity_type,entity_id,search_blob) VALUES (?,?,?)
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET search_blob=excluded.search_blob`)
    .bind(kind, id, compact(`${value} ${py.full} ${py.initials}`)).run();
}

export type SearchOrderAccess = {
  finance: boolean;
  materials: boolean;
  tasks: boolean;
  ownerUserId?: string;
};

export async function searchOrdersPage(
  db: AppDatabase,
  query: string,
  access: SearchOrderAccess,
  pageSize: number,
  offset: number,
): Promise<{ rows: GlobalSearchOrder[]; hasMore: boolean }> {
  const terms = searchTerms(query);
  if (!terms.length) return { rows: [], hasMore: false };
  const blobParts = ["search_order_blob", ...(access.finance ? ["search_finance_blob"] : []), ...(access.materials ? ["search_material_blob"] : []), ...(access.tasks ? ["search_task_blob"] : [])];
  const clauses = terms.map(() => `(${blobParts.map((part) => `${part} LIKE ?`).join(" OR ")})`);
  const values = terms.flatMap((term) => blobParts.map(() => likePattern(term)));
  const ownerClause = access.ownerUserId ? " AND o.owner_user_id=?" : "";
  const result = await db.prepare(`SELECT i.order_no,i.agent_name,i.project_name,i.main_applicant,i.match_details FROM order_search_index i JOIN orders o ON o.id=i.order_id WHERE ${clauses.map((clause) => clause.replaceAll("search_", "i.search_")).join(" AND ")}${ownerClause} ORDER BY i.updated_at DESC,i.order_id DESC LIMIT ? OFFSET ?`)
    .bind(...values, ...(access.ownerUserId ? [access.ownerUserId] : []), pageSize + 1, offset).all<Row>();
  const rows = result.results.slice(0, pageSize).map((row) => {
    const details = JSON.parse(String(row.match_details)) as SearchSource[];
    const allowed = details.filter((item) => item.domain === "order" || (item.domain === "finance" && access.finance) || (item.domain === "materials" && access.materials) || (item.domain === "tasks" && access.tasks));
    const matches = terms.map((term) => allowed.find((item) => item.search.includes(term))).filter((item): item is SearchSource => Boolean(item));
    const summaries = [...new Map(matches.map((item) => [item.label, item])).values()].slice(0, 3);
    const target = matches.find((item, index) => /^\d+(?:\.\d+)?$/u.test(terms[index] || "") && item.tab === "finance")
      || matches.find((item) => item.tab !== "workflow") || matches[0];
    return {
      order_no: row.order_no, agent_name: row.agent_name, project_name: row.project_name, main_applicant: row.main_applicant,
      match_summary: summaries.map((item) => item.label).join(" · ") || "订单资料",
      target_tab: normalizeOrderDetailTab(target?.tab),
    } as GlobalSearchOrder;
  });
  return { rows, hasMore: result.results.length > pageSize };
}

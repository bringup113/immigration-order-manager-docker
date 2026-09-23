import type { ChatGPTUser } from "@/app/chatgpt-auth";
import type { AppDatabase } from "@/db/driver";
import type {
  GlobalSearchAgent,
  GlobalSearchGroup,
  GlobalSearchPage,
  GlobalSearchProject,
  GlobalSearchResponse,
} from "@/lib/api-contracts";
import { hasPermission } from "@/lib/docker-auth";
import { canAccessAllOrders, orderScopeFilter } from "@/lib/order-access";
import { likePattern, searchOrdersPage, searchTerms } from "@/lib/order-search";

const groups = ["orders", "projects", "agents"] as const;

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(1, parsed))
    : fallback;
}

function requestedGroup(value: string | null): GlobalSearchGroup | "all" {
  return groups.includes(value as GlobalSearchGroup)
    ? (value as GlobalSearchGroup)
    : "all";
}

function pageInfo(
  page: number,
  pageSize: number,
  loaded: boolean,
  hasMore = false,
): GlobalSearchPage {
  return { page, pageSize, hasMore, loaded };
}

export async function readGlobalSearch(
  db: AppDatabase,
  user: ChatGPTUser,
  searchParams: URLSearchParams,
): Promise<GlobalSearchResponse> {
  const query = (searchParams.get("q") || "").trim().slice(0, 160);
  const group = requestedGroup(searchParams.get("group"));
  const page = positiveInteger(searchParams.get("page"), 1, 100_000);
  const requestedPageSize = searchParams.get("pageSize");
  const orderPageSize = positiveInteger(requestedPageSize, query ? 12 : 5, 30);
  const entityPageSize = positiveInteger(requestedPageSize, query ? 8 : 5, 30);
  const loads = (candidate: GlobalSearchGroup) =>
    group === "all" || group === candidate;
  const orderScope = orderScopeFilter(user, "o");
  const canReadAllOrders = canAccessAllOrders(user);
  const canReadProjects = hasPermission(user, "projects.read");
  const canReadAgents = hasPermission(user, "agents.read");
  const orderOffset = (page - 1) * orderPageSize;
  const entityOffset = (page - 1) * entityPageSize;
  const pagination: GlobalSearchResponse["pagination"] = {
    orders: pageInfo(page, orderPageSize, loads("orders")),
    projects: pageInfo(page, entityPageSize, loads("projects") && canReadProjects),
    agents: pageInfo(page, entityPageSize, loads("agents") && canReadAgents),
  };

  if (!query) {
    const [orderRows, projectRows, agentRows] = await Promise.all([
      loads("orders")
        ? db
            .prepare(
              `SELECT o.order_no,c.name AS agent_name,o.project_name_snapshot AS project_name,
          (SELECT name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' LIMIT 1) AS main_applicant
          FROM orders o JOIN agents c ON c.id=o.agent_id WHERE ${orderScope.sql}
          ORDER BY o.updated_at DESC,o.id DESC LIMIT ? OFFSET ?`,
            )
            .bind(...orderScope.values, orderPageSize + 1, orderOffset)
            .all()
        : Promise.resolve({ results: [] }),
      loads("projects") && canReadProjects
        ? db
            .prepare(
              `SELECT p.id,p.code,p.name,p.country FROM projects p
          WHERE ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.project_id=p.id AND ${orderScope.sql})`}
          ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?`,
            )
            .bind(
              ...(canReadAllOrders ? [] : orderScope.values),
              entityPageSize + 1,
              entityOffset,
            )
            .all<GlobalSearchProject>()
        : Promise.resolve({ results: [] as GlobalSearchProject[] }),
      loads("agents") && canReadAgents
        ? db
            .prepare(
              `SELECT c.id,c.name,c.contact_name,c.phone FROM agents c
          WHERE ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.agent_id=c.id AND ${orderScope.sql})`}
          ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`,
            )
            .bind(
              ...(canReadAllOrders ? [] : orderScope.values),
              entityPageSize + 1,
              entityOffset,
            )
            .all<GlobalSearchAgent>()
        : Promise.resolve({ results: [] as GlobalSearchAgent[] }),
    ]);

    pagination.orders.hasMore = orderRows.results.length > orderPageSize;
    pagination.projects.hasMore = projectRows.results.length > entityPageSize;
    pagination.agents.hasMore = agentRows.results.length > entityPageSize;
    return {
      orders: orderRows.results.slice(0, orderPageSize) as GlobalSearchResponse["orders"],
      projects: projectRows.results.slice(0, entityPageSize),
      agents: agentRows.results.slice(0, entityPageSize),
      pagination,
    };
  }

  const terms = searchTerms(query);
  const patterns = terms.map(likePattern);
  const entityMatch = terms.length
    ? terms.map(() => "i.search_blob LIKE ?").join(" AND ")
    : "FALSE";
  const canReadFinance = hasPermission(user, "finance.read");
  const canReadMaterials = hasPermission(user, "materials.read");
  const canReadTasks = hasPermission(user, "tasks.read");
  const [orderPage, projectRows, agentRows] = await Promise.all([
    loads("orders")
      ? searchOrdersPage(
          db,
          query,
          {
            finance: canReadFinance,
            materials: canReadMaterials,
            tasks: canReadTasks,
            ownerUserId: canReadAllOrders ? undefined : user.id,
          },
          orderPageSize,
          orderOffset,
        )
      : Promise.resolve({ rows: [], hasMore: false }),
    loads("projects") && canReadProjects
      ? db
          .prepare(
            `SELECT p.id,p.code,p.name,p.country FROM projects p
        JOIN entity_search_index i ON i.entity_type='project' AND i.entity_id=p.id
        WHERE ${entityMatch} AND ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.project_id=p.id AND ${orderScope.sql})`}
        ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?`,
          )
          .bind(
            ...patterns,
            ...(canReadAllOrders ? [] : orderScope.values),
            entityPageSize + 1,
            entityOffset,
          )
          .all<GlobalSearchProject>()
      : Promise.resolve({ results: [] as GlobalSearchProject[] }),
    loads("agents") && canReadAgents
      ? db
          .prepare(
            `SELECT c.id,c.name,c.contact_name,c.phone FROM agents c
        JOIN entity_search_index i ON i.entity_type='agent' AND i.entity_id=c.id
        WHERE ${entityMatch} AND ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.agent_id=c.id AND ${orderScope.sql})`}
        ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`,
          )
          .bind(
            ...patterns,
            ...(canReadAllOrders ? [] : orderScope.values),
            entityPageSize + 1,
            entityOffset,
          )
          .all<GlobalSearchAgent>()
      : Promise.resolve({ results: [] as GlobalSearchAgent[] }),
  ]);

  pagination.orders.hasMore = orderPage.hasMore;
  pagination.projects.hasMore = projectRows.results.length > entityPageSize;
  pagination.agents.hasMore = agentRows.results.length > entityPageSize;
  const pending = await db
    .prepare(
      `SELECT 1 FROM search_jobs j JOIN orders o ON j.entity_type='order' AND j.entity_id=o.id WHERE ${orderScope.sql} LIMIT 1`,
    )
    .bind(...orderScope.values)
    .first();

  return {
    orders: orderPage.rows,
    projects: projectRows.results.slice(0, entityPageSize),
    agents: agentRows.results.slice(0, entityPageSize),
    terms,
    indexing: Boolean(pending),
    pagination,
  };
}

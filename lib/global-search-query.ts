import type { ChatGPTUser } from "@/app/chatgpt-auth";
import type { AppDatabase } from "@/db/driver";
import { hasPermission } from "@/lib/docker-auth";
import { canAccessAllOrders, orderScopeFilter } from "@/lib/order-access";
import { likePattern, searchOrders, searchTerms } from "@/lib/order-search";

export async function readGlobalSearch(
  db: AppDatabase,
  user: ChatGPTUser,
  searchParams: URLSearchParams,
) {
  const query = (searchParams.get("q") || "").trim().slice(0, 160);
  const orderScope = orderScopeFilter(user, "o");
  const canReadAllOrders = canAccessAllOrders(user);
  const canReadProjects = hasPermission(user, "projects.read");
  const canReadAgents = hasPermission(user, "agents.read");

  if (!query) {
    const [orders, projects, agents] = await Promise.all([
      db
        .prepare(
          `SELECT o.order_no,c.name AS agent_name,o.project_name_snapshot AS project_name,
        (SELECT name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' LIMIT 1) AS main_applicant
        FROM orders o JOIN agents c ON c.id=o.agent_id WHERE ${orderScope.sql} ORDER BY o.updated_at DESC LIMIT 5`,
        )
        .bind(...orderScope.values)
        .all(),
      canReadProjects
        ? db
            .prepare(
              `SELECT p.id,p.code,p.name,p.country FROM projects p
        WHERE ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.project_id=p.id AND ${orderScope.sql})`}
        ORDER BY p.updated_at DESC LIMIT 5`,
            )
            .bind(...(canReadAllOrders ? [] : orderScope.values))
            .all()
        : Promise.resolve({ results: [] }),
      canReadAgents
        ? db
            .prepare(
              `SELECT c.id,c.name,c.contact_name,c.phone FROM agents c
        WHERE ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.agent_id=c.id AND ${orderScope.sql})`}
        ORDER BY c.updated_at DESC LIMIT 5`,
            )
            .bind(...(canReadAllOrders ? [] : orderScope.values))
            .all()
        : Promise.resolve({ results: [] }),
    ]);

    return {
      orders: orders.results,
      projects: projects.results,
      agents: agents.results,
    };
  }

  const terms = searchTerms(query);
  const canReadFinance = hasPermission(user, "finance.read");
  const canReadMaterials = hasPermission(user, "materials.read");
  const canReadTasks = hasPermission(user, "tasks.read");
  const patterns = terms.map(likePattern);
  const [orders, projectRows, agentRows] = await Promise.all([
    searchOrders(query, {
      finance: canReadFinance,
      materials: canReadMaterials,
      tasks: canReadTasks,
      ownerUserId: canReadAllOrders ? undefined : user.id,
    }),
    canReadProjects
      ? db
          .prepare(
            `SELECT p.id,p.code,p.name,p.country FROM projects p
      JOIN entity_search_index i ON i.entity_type='project' AND i.entity_id=p.id
      WHERE ${terms.map(() => "i.search_blob LIKE ?").join(" AND ")} AND ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.project_id=p.id AND ${orderScope.sql})`}
      ORDER BY p.updated_at DESC LIMIT 8`,
          )
          .bind(...patterns, ...(canReadAllOrders ? [] : orderScope.values))
          .all()
      : Promise.resolve({ results: [] }),
    canReadAgents
      ? db
          .prepare(
            `SELECT c.id,c.name,c.contact_name,c.phone FROM agents c
      JOIN entity_search_index i ON i.entity_type='agent' AND i.entity_id=c.id
      WHERE ${terms.map(() => "i.search_blob LIKE ?").join(" AND ")} AND ${canReadAllOrders ? "TRUE" : `EXISTS (SELECT 1 FROM orders o WHERE o.agent_id=c.id AND ${orderScope.sql})`}
      ORDER BY c.updated_at DESC LIMIT 8`,
          )
          .bind(...patterns, ...(canReadAllOrders ? [] : orderScope.values))
          .all()
      : Promise.resolve({ results: [] }),
  ]);

  const pending = await db
    .prepare(
      `SELECT 1 FROM search_jobs j JOIN orders o ON j.entity_type='order' AND j.entity_id=o.id WHERE ${orderScope.sql} LIMIT 1`,
    )
    .bind(...orderScope.values)
    .first();

  return {
    orders,
    projects: projectRows.results,
    agents: agentRows.results,
    terms,
    indexing: Boolean(pending),
  };
}

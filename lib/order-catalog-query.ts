import type { ChatGPTUser } from "@/app/chatgpt-auth";
import type { AppDatabase } from "@/db/driver";
import { hasPermission } from "@/lib/docker-auth";

export async function readOrderCatalogs(
  db: AppDatabase,
  user: ChatGPTUser,
  searchParams: URLSearchParams,
) {
  const projectId = searchParams.get("projectId") || "";
  if (projectId) {
    const project = await db
      .prepare("SELECT id FROM projects WHERE id=? AND status='ACTIVE'")
      .bind(projectId)
      .first();
    if (!project)
      return { ok: false as const, error: "项目不存在或已停用。", status: 404 };

    const [projectChannels, projectSteps, projectPlans, projectMaterials] =
      await Promise.all([
        db
          .prepare(
            "SELECT project_id,channel_id,is_default FROM project_channels WHERE project_id=? ORDER BY is_default DESC",
          )
          .bind(projectId)
          .all(),
        db
          .prepare(
            "SELECT id,project_id,name,sequence,required,due_days,notes FROM project_step_templates WHERE project_id=? ORDER BY sequence",
          )
          .bind(projectId)
          .all(),
        db
          .prepare(
            "SELECT id,project_id,plan_type,sequence AS stage_no,name,currency,amount_minor,due_days,NULL AS channel_id,notes FROM project_plan_templates WHERE project_id=? ORDER BY plan_type,sequence",
          )
          .bind(projectId)
          .all(),
        db
          .prepare(
            "SELECT id,project_id,name,scope,sequence AS sort_order,required,notes FROM project_material_templates WHERE project_id=? ORDER BY sequence",
          )
          .bind(projectId)
          .all(),
      ]);

    return {
      ok: true as const,
      data: {
        projectChannels: projectChannels.results,
        projectSteps: projectSteps.results,
        projectPlans: projectPlans.results,
        projectMaterials: projectMaterials.results,
      },
    };
  }

  const [agents, projects, channels, rates, owners] = await Promise.all([
    db
      .prepare(
        "SELECT id,name,system_managed FROM agents WHERE active=1 ORDER BY system_managed DESC,name",
      )
      .all(),
    db
      .prepare(
        `SELECT p.id,p.code,p.name,p.country,p.default_receivable_currency,p.provider_currency,p.revision_no,
      (SELECT pc.channel_id FROM project_channels pc WHERE pc.project_id=p.id AND pc.is_default=1 LIMIT 1) AS default_channel_id
      FROM projects p WHERE p.status='ACTIVE' ORDER BY p.name`,
      )
      .all(),
    db
      .prepare(
        "SELECT id,name,settlement_currency,country FROM channels WHERE active=1 ORDER BY name",
      )
      .all(),
    db
      .prepare(
        "SELECT currency,name,rate_per_usd_scaled,rate_per_usd_scaled/100000000.0 AS rate_per_usd FROM exchange_rates WHERE active=1 ORDER BY currency",
      )
      .all(),
    hasPermission(user, "orders.assign")
      ? db
          .prepare(
            "SELECT id,display_name,username FROM users WHERE active=1 ORDER BY display_name,username",
          )
          .all()
      : Promise.resolve({
          results: [
            {
              id: user.id,
              display_name: user.displayName,
              username: user.username,
            },
          ],
        }),
  ]);

  return {
    ok: true as const,
    data: {
      agents: agents.results,
      projects: projects.results,
      channels: channels.results,
      rates: rates.results,
      projectChannels: [],
      projectSteps: [],
      projectPlans: [],
      projectMaterials: [],
      owners: owners.results,
      currentUserId: user.id,
      canAssignOrders: hasPermission(user, "orders.assign"),
    },
  };
}

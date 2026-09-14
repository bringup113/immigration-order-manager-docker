type DataResourcePolicy = {
  readPermission: string;
  writePermission?: string;
  entityType?: string;
  summary?: string;
  snapshot?: {
    table: string;
    key: "id" | "currency";
  };
};

export const DATA_RESOURCE_POLICIES = {
  dashboard: { readPermission: "dashboard.read" },
  orders: {
    readPermission: "orders.read",
    writePermission: "orders.write",
    entityType: "ORDER",
    summary: "创建订单",
  },
  search: { readPermission: "orders.read" },
  "order-number": { readPermission: "orders.write" },
  catalogs: { readPermission: "orders.write" },
  agents: {
    readPermission: "agents.read",
    writePermission: "agents.write",
    entityType: "AGENT",
    summary: "保存代理",
    snapshot: { table: "agents", key: "id" },
  },
  channels: {
    readPermission: "channels.read",
    writePermission: "channels.write",
    entityType: "CHANNEL",
    summary: "保存渠道商",
    snapshot: { table: "channels", key: "id" },
  },
  projects: {
    readPermission: "projects.read",
    writePermission: "projects.write",
    entityType: "PROJECT",
    summary: "保存项目",
    snapshot: { table: "projects", key: "id" },
  },
  rates: {
    readPermission: "currencies.read",
    writePermission: "currencies.write",
    entityType: "CURRENCY",
    summary: "修改币种",
    snapshot: { table: "exchange_rates", key: "currency" },
  },
  currencies: { readPermission: "currencies.read" },
} as const satisfies Record<string, DataResourcePolicy>;

export type DataResource = keyof typeof DATA_RESOURCE_POLICIES;

export function getDataResourcePolicy(
  resource: string,
): DataResourcePolicy | null {
  return DATA_RESOURCE_POLICIES[resource as DataResource] || null;
}

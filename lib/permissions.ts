export const PERMISSION_GROUPS = [
  { label: "首页", permissions: [["dashboard.read", "查看首页"]] },
  { label: "订单", permissions: [["orders.read", "查看订单"], ["orders.write", "修改订单"], ["orders.assign", "分配订单负责人"], ["orders.override", "强制调整订单流程"]] },
  { label: "申请人", permissions: [["applicants.write", "修改申请人资料"], ["applicants.mrz", "识别并确认护照 MRZ"]] },
  { label: "订单待办", permissions: [["tasks.read", "查看订单待办"], ["tasks.write", "管理订单待办"]] },
  { label: "订单收支", permissions: [["finance.read", "查看收支"], ["finance.write", "登记、修改和作废收支"], ["finance.restore", "恢复已作废收支"]] },
  { label: "材料文件", permissions: [["materials.read", "预览材料"], ["materials.write", "上传、替换和作废材料"], ["materials.restore", "恢复历史材料文件"], ["materials.download", "下载原文件"]] },
  { label: "代理", permissions: [["agents.read", "查看代理"], ["agents.write", "管理代理"]] },
  { label: "项目", permissions: [["projects.read", "查看项目"], ["projects.write", "修改项目"], ["projects.export", "导出项目"], ["projects.import", "导入和覆盖项目"]] },
  { label: "渠道商", permissions: [["channels.read", "查看渠道商"], ["channels.write", "修改渠道商"]] },
  { label: "币种", permissions: [["currencies.read", "查看币种"], ["currencies.write", "修改币种"]] },
  { label: "材料库", permissions: [["material_catalog.read", "查看材料库"], ["material_catalog.write", "管理材料库"]] },
  { label: "用户与角色", permissions: [["users.read", "查看用户"], ["users.write", "管理普通用户"], ["roles.read", "查看角色"], ["roles.write", "管理自定义角色"]] },
  { label: "操作日志", permissions: [["audit.read", "查看操作日志"], ["audit.export", "导出操作日志"]] },
] as const;

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map(([code]) => code));

const PERMISSION_DEPENDENCIES: Record<string, string[]> = {
  "orders.write": ["orders.read"],
  "orders.assign": ["orders.write", "orders.read"],
  "orders.override": ["orders.write", "orders.read"],
  "applicants.write": ["orders.write", "orders.read"],
  "applicants.mrz": ["applicants.write", "materials.write", "materials.read", "orders.read"],
  "tasks.read": ["orders.read"],
  "tasks.write": ["tasks.read", "orders.read"],
  "finance.read": ["orders.read"],
  "finance.write": ["finance.read", "orders.read"],
  "finance.restore": ["finance.write", "finance.read", "orders.read"],
  "materials.read": ["orders.read"],
  "materials.write": ["materials.read", "orders.read"],
  "materials.restore": ["materials.write", "materials.read", "orders.read"],
  "materials.download": ["materials.read", "orders.read"],
  "agents.write": ["agents.read"],
  "projects.write": ["projects.read"],
  "projects.export": ["projects.read"],
  "projects.import": ["projects.write", "projects.read"],
  "channels.write": ["channels.read"],
  "currencies.write": ["currencies.read"],
  "material_catalog.write": ["material_catalog.read"],
  "users.read": ["roles.read"],
  "users.write": ["users.read", "roles.read"],
  "roles.write": ["roles.read"],
  "audit.export": ["audit.read"],
};

export function validPermissions(values: unknown) {
  if (!Array.isArray(values)) return [];
  const allowed = new Set<string>(ALL_PERMISSIONS);
  const selected = new Set(values.map(String).filter((value) => allowed.has(value)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...selected]) {
      for (const dependency of PERMISSION_DEPENDENCIES[permission] || []) {
        if (!selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
    }
  }
  return [...selected];
}

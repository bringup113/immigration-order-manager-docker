export const orderSortOptions = [
  { value: "signed_desc", label: "签约日期：从新到旧" },
  { value: "signed_asc", label: "签约日期：从旧到新" },
  { value: "created_desc", label: "最近创建" },
  { value: "updated_desc", label: "最近更新" },
] as const;

export const DEFAULT_ORDER_SORT = "signed_desc";

export function orderSortSql(value: string | null) {
  switch (value) {
    case "signed_asc":
      return "o.signed_at ASC NULLS LAST,o.created_at ASC,o.id ASC";
    case "created_desc":
      return "o.created_at DESC,o.id DESC";
    case "updated_desc":
      return "o.updated_at DESC,o.id DESC";
    default:
      return "o.signed_at DESC NULLS LAST,o.created_at DESC,o.id DESC";
  }
}

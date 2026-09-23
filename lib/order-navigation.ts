import type { OrderDetailTab } from "@/lib/api-contracts";

export const orderDetailTabs = [
  "workflow",
  "finance",
  "people",
  "common",
] as const satisfies readonly OrderDetailTab[];

export function isOrderDetailTab(value: unknown): value is OrderDetailTab {
  return orderDetailTabs.includes(value as OrderDetailTab);
}

export function normalizeOrderDetailTab(
  value: unknown,
  fallback: OrderDetailTab = "workflow",
): OrderDetailTab {
  return isOrderDetailTab(value) ? value : fallback;
}

export function orderDetailHref(
  orderNo: string,
  tab?: unknown,
  surface: "desktop" | "mobile" = "desktop",
) {
  const prefix = surface === "mobile" ? "/m/orders" : "/orders";
  if (surface === "mobile") {
    return `${prefix}/${encodeURIComponent(orderNo)}${isOrderDetailTab(tab) ? `?tab=${tab}` : ""}`;
  }
  const normalized = normalizeOrderDetailTab(tab);
  return `${prefix}/${encodeURIComponent(orderNo)}${normalized === "workflow" ? "" : `?tab=${normalized}`}`;
}

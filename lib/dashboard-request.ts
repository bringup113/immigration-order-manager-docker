import type { ReminderRange } from "@/lib/dashboard-query";

export type DashboardRequest = {
  range?: ReminderRange;
  page: number;
  pageSize: number;
  mobileSurface: boolean;
};

export function parseDashboardRequest(searchParams: Pick<URLSearchParams, "get">): DashboardRequest {
  const requestedRange = searchParams.get("range");
  const range: ReminderRange | undefined =
    requestedRange === "all" ||
    requestedRange === "overdue" ||
    requestedRange === "today" ||
    requestedRange === "week"
      ? requestedRange
      : undefined;

  return {
    range,
    page: Math.min(
      100_000,
      Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1),
    ),
    pageSize: Math.min(
      30,
      Math.max(
        5,
        Number.parseInt(searchParams.get("pageSize") || "30", 10) || 30,
      ),
    ),
    mobileSurface: searchParams.get("surface") === "mobile",
  };
}

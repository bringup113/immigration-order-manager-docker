import { MobileOrderDetail } from "@/components/mobile/mobile-order-detail";
import { isOrderDetailTab } from "@/lib/order-navigation";

export default async function MobileOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>;
  searchParams: Promise<{ tab?: string | string[]; from?: string; range?: string }>;
}) {
  const { orderNo } = await params;
  const { tab, from, range } = await searchParams;
  const requested = Array.isArray(tab) ? tab[0] : tab;
  const dashboardRange = range === "overdue" || range === "today" || range === "week" ? range : undefined;
  return <MobileOrderDetail key={orderNo} orderNo={orderNo} requestedTab={isOrderDetailTab(requested) ? requested : "workflow"} source={from === "search" || from === "dashboard" ? from : undefined} dashboardRange={dashboardRange} />;
}

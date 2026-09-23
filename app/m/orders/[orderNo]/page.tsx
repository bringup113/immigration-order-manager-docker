import { MobileOrderDetail } from "@/components/mobile/mobile-order-detail";
import { isOrderDetailTab } from "@/lib/order-navigation";

export default async function MobileOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>;
  searchParams: Promise<{ tab?: string | string[]; from?: string }>;
}) {
  const { orderNo } = await params;
  const { tab, from } = await searchParams;
  const requested = Array.isArray(tab) ? tab[0] : tab;
  return <MobileOrderDetail key={orderNo} orderNo={orderNo} requestedTab={isOrderDetailTab(requested) ? requested : "workflow"} source={from === "search" || from === "dashboard" ? from : undefined} />;
}

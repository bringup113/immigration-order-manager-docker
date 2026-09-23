import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrderDetail } from "@/components/order-detail";
import { PageHeader } from "@/components/page-header";

type OrderDetailTab =
  | "workflow"
  | "finance"
  | "people"
  | "common";

type SearchParams = {
  tab?: string | string[];
  returnTo?: string | string[];
};

function isOrderDetailTab(
  value: unknown,
): value is OrderDetailTab {
  return (
    value === "workflow" ||
    value === "finance" ||
    value === "people" ||
    value === "common"
  );
}

function safeReturnTo(
  value: string | string[] | undefined,
) {
  if (typeof value !== "string") {
    return "/orders";
  }

  /*
   * 只允许返回订单列表自身。
   *
   * 合法示例：
   * /orders
   * /orders?page=3
   * /orders?page=3&q=王小明&sort=updated_desc
   *
   * 不允许外部 URL，避免开放跳转问题。
   */
  if (
    value === "/orders" ||
    value.startsWith("/orders?")
  ) {
    return value;
  }

  return "/orders";
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const { tab, returnTo } = await searchParams;

  const initialTab: OrderDetailTab =
    isOrderDetailTab(tab)
      ? tab
      : "workflow";

  const ordersReturnUrl =
    safeReturnTo(returnTo);

  return (
    <AppShell>
      <PageHeader
        eyebrow="订单详情"
        title="订单详情"
        description="办理项目、主申请人及订单进度"
        action={
          <Link
            href={ordersReturnUrl}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            返回订单列表
          </Link>
        }
      />

      <OrderDetail
        orderNo={id}
        initialTab={initialTab}
      />
    </AppShell>
  );
}
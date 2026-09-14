import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrderDetail } from "@/components/order-detail";
import { PageHeader } from "@/components/page-header";

export default async function OrderDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AppShell><PageHeader eyebrow="订单详情" title="订单详情" description="办理项目、主申请人及订单进度" action={<Link href="/orders" className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft size={16}/> 返回订单列表</Link>}/><OrderDetail orderNo={id}/></AppShell>}

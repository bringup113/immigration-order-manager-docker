import { Database, LoaderCircle } from "lucide-react";

export function LoadingState() { return <div className="panel flex min-h-56 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18}/> 正在读取数据…</div>; }
export function ErrorState({ message }: { message: string }) { return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{message}</div>; }
export function EmptyState({ title, description }: { title: string; description: string }) { return <div className="panel flex min-h-60 flex-col items-center justify-center px-6 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Database size={22}/></span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p></div>; }

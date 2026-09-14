"use client";

import { useCurrentUser } from "@/components/current-user-provider";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BriefcaseBusiness,
  ClipboardList,
  ContactRound,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  ScrollText,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const nav = [
  {
    href: "/",
    label: "首页",
    icon: LayoutDashboard,
    permission: "dashboard.read",
  },
  {
    href: "/orders",
    label: "订单管理",
    icon: BriefcaseBusiness,
    permission: "orders.read",
  },
  {
    href: "/projects",
    label: "项目管理",
    icon: FolderKanban,
    permission: "projects.read",
  },
  {
    href: "/agents",
    label: "代理管理",
    icon: ContactRound,
    permission: "agents.read",
  },
  {
    href: "/channels",
    label: "渠道商",
    icon: UsersRound,
    permission: "channels.read",
  },
];

type SearchData = {
  indexing?: boolean;
  orders: {
    order_no: string;
    agent_name: string;
    project_name: string;
    main_applicant: string | null;
    match_summary?: string;
    target_tab?: string;
  }[];
  projects: { id: string; code: string; name: string; country: string }[];
  agents: {
    id: string;
    name: string;
    contact_name: string | null;
    phone: string | null;
  }[];
};

const emptySearch: SearchData = { orders: [], projects: [], agents: [] };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchData, setSearchData] = useState<SearchData>(emptySearch);
  const [searchNotice, setSearchNotice] = useState("");
  const [selectedResult, setSelectedResult] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const top = savedScroll.current;
    savedScroll.current = null;
    if (top === null) return;
    if (listRef.current) listRef.current.scrollTop = top;
    let second = 0;
    const frame = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = top;
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(second);
    };
  }, [searchData]);
  const { user: currentUser } = useCurrentUser();
  useEffect(() => {
    if (currentUser.mustChangePassword && pathname !== "/settings/profile")
      router.replace("/settings/profile?required=1");
    else if (currentUser.mfaRequired && pathname !== "/settings/profile")
      router.replace("/settings/profile?mfa_required=1");
  }, [currentUser, pathname, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const canSearch = Boolean(
        currentUser?.permissions.includes("*") ||
          currentUser?.permissions.includes("orders.read"),
      );
      if (
        canSearch &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [currentUser]);

  useEffect(() => {
    if (!searchOpen) return;
    let controller: AbortController | undefined;
    let timer: number | undefined;
    let disposed = false;
    let needsRefresh = true;
    let initial = true;
    let attempt = 0;
    const deadline = Date.now() + 60000;
    const expire = () => {
      window.clearTimeout(timer);
      controller?.abort();
      if (!disposed && needsRefresh) {
        setSearching(false);
        setSearchNotice("自动刷新已暂停，请稍后重新搜索。");
      }
      needsRefresh = false;
    };
    const deadlineTimer = window.setTimeout(expire, 60000);
    const search = async () => {
      if (disposed || document.hidden || !needsRefresh) return;
      if (Date.now() >= deadline) {
        expire();
        return;
      }
      const request = new AbortController();
      controller = request;
      const wasInitial = initial;
      if (wasInitial) {
        setSearching(true);
        setSearchNotice("");
      }
      try {
        const response = await fetch(
          `/api/data/search?q=${encodeURIComponent(searchQuery)}`,
          { cache: "no-store", signal: request.signal },
        );
        const result: SearchData & { error?: string } = await response.json();
        if (!response.ok) throw new Error(result.error || "搜索失败");
        if (disposed || request.signal.aborted) return;
        if (!wasInitial)
          savedScroll.current = listRef.current?.scrollTop ?? null;
        const values = [
          ...result.orders.map((row) => `order-${row.order_no}`),
          ...result.projects.map((row) => `project-${row.id}`),
          ...result.agents.map((row) => `agent-${row.id}`),
        ];
        setSelectedResult((current) =>
          values.includes(current) ? current : values[0] || "",
        );
        setSearchData(result);
        initial = false;
        needsRefresh = Boolean(searchQuery.trim() && result.indexing);
        if (needsRefresh) {
          const delay = Math.min(8000, 1000 * 2 ** Math.min(attempt++, 3));
          if (Date.now() + delay < deadline)
            timer = window.setTimeout(() => void search(), delay);
        } else window.clearTimeout(deadlineTimer);
      } catch {
        if (!disposed && !request.signal.aborted) {
          needsRefresh = false;
          window.clearTimeout(deadlineTimer);
          setSearchNotice("搜索更新失败，已保留原有结果，请稍后重新搜索。");
        }
      } finally {
        if (!disposed && !request.signal.aborted) setSearching(false);
      }
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (document.hidden) {
        controller?.abort();
        setSearching(false);
      } else if (needsRefresh && Date.now() < deadline)
        timer = window.setTimeout(() => void search(), 300);
      else if (needsRefresh) expire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    timer = window.setTimeout(() => void search(), 300);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(deadlineTimer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [searchOpen, searchQuery]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
  }

  function goTo(href: string) {
    closeSearch();
    router.push(href);
  }

  const resultCount =
    searchData.orders.length +
    searchData.projects.length +
    searchData.agents.length;
  const can = (permission: string) =>
    Boolean(
      currentUser?.permissions.includes("*") ||
        currentUser?.permissions.includes(permission),
    );

  return (
    <div className="min-h-screen bg-[#f4f7f9] text-slate-900">
      {open && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="关闭导航"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[244px] flex-col bg-[#142238] text-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-[76px] items-center justify-between border-b border-white/8 px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[#18a99b] font-black">
              M
            </span>
            <span>
              <b className="block text-[15px] tracking-wide">MIGRA</b>
              <small className="block text-[10px] text-slate-400">
                移民订单管理
              </small>
            </span>
          </Link>
          <button className="lg:hidden" onClick={() => setOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-6">
          <p className="px-3 pb-2 text-[10px] font-semibold tracking-[.18em] text-slate-500">
            工作台
          </p>
          {nav
            .filter((item) => can(item.permission))
            .map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`nav-item ${active ? "active" : ""}`}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
        </nav>
        <div className="border-t border-white/8 p-3">
          {can("currencies.read") && (
            <Link
              href="/settings/currencies"
              onClick={() => setOpen(false)}
              className={`nav-item w-full ${pathname === "/settings/currencies" ? "active" : ""}`}
            >
              <Settings size={18} />
              <span>币种设置</span>
            </Link>
          )}
          {can("material_catalog.read") && (
            <Link
              href="/settings/materials"
              onClick={() => setOpen(false)}
              className={`nav-item w-full ${pathname === "/settings/materials" ? "active" : ""}`}
            >
              <ClipboardList size={18} />
              <span>材料管理</span>
            </Link>
          )}
          {can("users.read") && (
            <Link
              href="/settings/users"
              onClick={() => setOpen(false)}
              className={`nav-item w-full ${pathname === "/settings/users" ? "active" : ""}`}
            >
              <UserRoundCog size={18} />
              <span>用户与角色</span>
            </Link>
          )}
          {can("audit.read") && (
            <Link href="/settings/system" className="nav-item w-full">
              <Settings size={18} />
              <span>运行状态</span>
            </Link>
          )}
          {can("audit.read") && (
            <Link
              href="/settings/audit"
              onClick={() => setOpen(false)}
              className={`nav-item w-full ${pathname === "/settings/audit" ? "active" : ""}`}
            >
              <ScrollText size={18} />
              <span>操作日志</span>
            </Link>
          )}
          <Link
            href="/settings/profile"
            onClick={() => setOpen(false)}
            className={`nav-item w-full ${pathname === "/settings/profile" ? "active" : ""}`}
          >
            <ShieldCheck size={18} />
            <span>登录与安全</span>
          </Link>
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <span className="grid size-9 place-items-center rounded-full bg-[#d8f3ef] text-sm font-bold text-[#0f766e]">
              {currentUser?.displayName?.slice(0, 1).toUpperCase() || "M"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {currentUser?.displayName || "正在识别…"}
              </p>
              <p className="truncate text-[10px] text-slate-400">
                {currentUser
                  ? `${currentUser.roleName} · ${currentUser.username}`
                  : ""}
              </p>
            </div>
            <form method="post" action="/api/auth/logout?return_to=/">
              <button
                type="submit"
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={16} />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[244px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur sm:px-7">
          <button className="mr-3 lg:hidden" onClick={() => setOpen(true)}>
            <Menu size={22} />
          </button>
          {can("orders.read") && (
            <>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="mr-auto grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500 sm:hidden"
                aria-label="全局搜索"
              >
                <Search size={18} />
              </button>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="hidden w-full max-w-sm items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-left text-slate-400 transition-colors hover:bg-slate-200/70 sm:flex"
              >
                <Search size={17} />
                <span className="text-sm">搜索全部订单数据...</span>
                <kbd className="ml-auto rounded border bg-white px-1.5 py-0.5 text-[10px]">
                  ⌘ K
                </kbd>
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            {can("dashboard.read") && (
              <Link
                href="/#reminders"
                className="relative grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                title="查看近期提醒"
                aria-label="查看近期提醒"
              >
                <Bell size={18} />
              </Link>
            )}
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">
                {new Intl.DateTimeFormat("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }).format(new Date())}
              </p>
              <p className="text-[11px] text-slate-400">正式数据模式</p>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1540px] p-4 sm:p-7 lg:p-8">
          {children}
        </main>
      </div>
      <CommandDialog
        open={searchOpen}
        onOpenChange={(value) => (value ? setSearchOpen(true) : closeSearch())}
        commandValue={selectedResult}
        onCommandValueChange={setSelectedResult}
        title="全局搜索"
        description="姓名、拼音、金额、收付款、材料和文件均可搜索；使用 + 组合多个条件"
        shouldFilter={false}
        className="sm:max-w-2xl"
      >
        <CommandInput
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder="例如：zhangsan+USD+15000 或 张三+护照"
        />
        <CommandList ref={listRef} className="max-h-[440px]">
          {searching && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              正在搜索…
            </div>
          )}
          {searchNotice && (
            <p role="status" className="px-4 py-2 text-xs text-amber-700">
              {searchNotice}
            </p>
          )}
          {!searchNotice && searchData.indexing && (
            <p className="px-4 py-2 text-xs text-slate-500">
              索引同步中，结果会自动更新；若长时间未完成，请稍后重新搜索。
            </p>
          )}
          {!searching && resultCount === 0 && (
            <CommandEmpty>
              {searchQuery ? "没有找到匹配内容" : "暂无可搜索的数据"}
            </CommandEmpty>
          )}
          {!searching && searchData.orders.length > 0 && (
            <CommandGroup heading={searchQuery ? "订单" : "最近订单"}>
              {searchData.orders.map((row) => (
                <CommandItem
                  key={row.order_no}
                  value={`order-${row.order_no}`}
                  onSelect={() =>
                    goTo(
                      `/orders/${encodeURIComponent(row.order_no)}${row.target_tab ? `?tab=${row.target_tab}` : ""}`,
                    )
                  }
                >
                  <BriefcaseBusiness />
                  <div className="min-w-0">
                    <p className="font-medium">{row.order_no}</p>
                    <p className="truncate text-xs text-slate-500">
                      {row.agent_name} · {row.project_name}
                      {row.main_applicant ? ` · ${row.main_applicant}` : ""}
                    </p>
                    {row.match_summary && (
                      <p className="mt-0.5 truncate text-xs font-medium text-teal-700">
                        命中：{row.match_summary}
                      </p>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!searching && searchData.projects.length > 0 && (
            <CommandGroup heading={searchQuery ? "项目" : "最近项目"}>
              {searchData.projects.map((row) => (
                <CommandItem
                  key={row.id}
                  value={`project-${row.id}`}
                  onSelect={() => goTo(`/projects/${row.id}`)}
                >
                  <FolderKanban />
                  <div className="min-w-0">
                    <p className="font-medium">{row.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {row.country} · {row.code}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!searching && searchData.agents.length > 0 && (
            <CommandGroup heading={searchQuery ? "代理" : "最近代理"}>
              {searchData.agents.map((row) => (
                <CommandItem
                  key={row.id}
                  value={`agent-${row.id}`}
                  onSelect={() => goTo(`/agents#agent-${row.id}`)}
                >
                  <ContactRound />
                  <div className="min-w-0">
                    <p className="font-medium">{row.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      代理来源{row.contact_name ? ` · ${row.contact_name}` : ""}
                      {row.phone ? ` · ${row.phone}` : ""}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  );
}

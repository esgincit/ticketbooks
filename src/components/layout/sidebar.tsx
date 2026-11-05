"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, UserCheck, FolderKanban, Ticket as TicketIcon, Layers, KanbanSquare,
  Inbox, BarChart3, Users, UsersRound, Bell, Settings, ScrollText, ChevronLeft, BookText, ClipboardCheck, ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { section: "Work", items: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/my-work", label: "My Work", icon: UserCheck },
    { href: "/available-work", label: "Available Work", icon: Inbox },
  ]},
  { section: "Delivery", items: [
    { href: "/projects", label: "Projects", icon: FolderKanban },
    { href: "/tickets", label: "Tickets", icon: TicketIcon },
    { href: "/backlog", label: "Backlog", icon: Layers },
    { href: "/board", label: "Board", icon: KanbanSquare },
    { href: "/test-plans", label: "Test Plans", icon: ClipboardCheck },
    { href: "/test-cases", label: "Test Cases", icon: ListChecks },
    { href: "/reports", label: "Reports", icon: BarChart3 },
  ]},
  { section: "Organization", items: [
    { href: "/users", label: "Users", icon: Users, permission: "user.view" },
    { href: "/teams", label: "Teams", icon: UsersRound },
    { href: "/audit-logs", label: "Audit Logs", icon: ScrollText, permission: "audit.view" },
  ]},
  { section: "Personal", items: [
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: "/settings", label: "Settings", icon: Settings },
  ]},
];

export function Sidebar({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const canSee = (permission?: string) => !permission || permissions.includes("*") || permissions.includes(permission);

  return (
    <aside
      className={cn(
        "sticky top-0 z-30 flex h-screen flex-col border-r border-black/20 bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] transition-[width] duration-150",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div className={cn("flex h-14 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
          <BookText className="h-4 w-4 text-white" />
        </span>
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-white">TicketBooks</span>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-3" aria-label="Primary">
        {NAV.map((group) => {
          const items = group.items.filter((i) => canSee(i.permission));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              {!collapsed && (
                <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest opacity-50">{group.section}</p>
              )}
              <ul className="space-y-0.5">
                {items.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`) || (href !== "/dashboard" && pathname.startsWith(href));
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        title={collapsed ? label : undefined}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors",
                          collapsed && "justify-center px-0",
                          active ? "bg-white/10 text-white ring-1 ring-white/10 [&_svg]:text-white" : "hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"
      >
        <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
      </button>
    </aside>
  );
}

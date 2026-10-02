"use client";

import { BookText } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { SessionUser } from "@/lib/auth/session";

export function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="flex">
      <Sidebar permissions={user.permissions} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="flex-1 px-4 py-5 md:px-6">{children}</main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><BookText className="h-3 w-3" /> TicketBooks<span className="ml-2">· Signed in as {user.email}</span></span>
          <span>Designed and developed by Sunil Sainath Reddy Vootkuri</span>
        </footer>
      </div>
    </div>
  );
}

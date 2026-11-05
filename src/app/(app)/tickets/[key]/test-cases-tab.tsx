"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { Skeleton } from "@/components/ui/field";
import { AutomationBadge, OutcomeBadge, errorText } from "@/components/test-cases/shared";

type Row = { id: string; key: string; title: string; automationStatus: string; stale: boolean; lastResult: string | null };

export default function TestCasesTab({ ticketKey }: { ticketKey: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ testCases: Row[] }>(`/api/test-cases?ticketKey=${encodeURIComponent(ticketKey)}&pageSize=100`)
      .then((d) => setRows(d.testCases))
      .catch((e) => setError(errorText(e, "Failed to load test cases")));
  }, [ticketKey]);

  if (error) return <p role="alert" className="px-4 py-6 text-sm text-destructive">{error}</p>;
  if (!rows) return <div className="p-4"><Skeleton className="h-16" /></div>;
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        No test cases are linked to this ticket. Link one from the <Link href="/test-cases" className="text-primary hover:underline">test case library</Link> by adding {ticketKey} to its linked tickets.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {rows.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
          <span className="font-mono text-[11px] text-muted-foreground">{c.key}</span>
          <Link href={`/test-cases/${c.key}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">{c.title}</Link>
          <AutomationBadge testCase={c} />
          <OutcomeBadge outcome={c.lastResult} />
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, Select, Skeleton } from "@/components/ui/field";
import { PriorityBadge } from "@/components/tickets/badges";
import { AutomationBadge, CaseFormDialog, CaseStatusBadge, OutcomeBadge, Pager, errorText, useTestMeta, type TestPermissions } from "@/components/test-cases/shared";
import { timeAgo } from "@/lib/utils";

type Row = {
  id: string; key: string; title: string; status: string; automationStatus: string; stale: boolean;
  lastResult: string | null; lastRunAt: string | null; priority: { id: string; name: string; color: string };
};
type Payload = { testCases: Row[]; total: number; page: number; pageSize: number; permissions: TestPermissions };

export default function TestCasesPage() {
  const router = useRouter();
  const meta = useTestMeta();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ projectId: "", status: "", automation: "", lastResult: "", q: "" });
  const set = (k: keyof typeof filters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page) });
    if (filters.projectId) p.set("projectId", filters.projectId);
    if (filters.status) p.set("status", filters.status);
    if (filters.lastResult) p.set("lastResult", filters.lastResult);
    if (filters.q.trim()) p.set("q", filters.q.trim());
    if (filters.automation === "STALE") p.set("automationStale", "true");
    else if (filters.automation) p.set("automationStatus", filters.automation);
    try {
      setData(await api<Payload>(`/api/test-cases?${p}`));
      setError(null);
    } catch (e) {
      setError(errorText(e, "Failed to load test cases"));
    }
  }, [filters, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight">Test Cases</h1>
        {data?.permissions.canManage && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New test case</Button>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label="Search test cases" placeholder="Search title or key" value={filters.q} onChange={(e) => set("q", e.target.value)} />
        <Select aria-label="Project" value={filters.projectId} onChange={(e) => set("projectId", e.target.value)}>
          <option value="">All projects</option>
          {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.key} - {p.name}</option>)}
        </Select>
        <Select aria-label="Status" value={filters.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">Any status</option>
          <option value="DRAFT">Draft</option>
          <option value="READY">Ready</option>
          <option value="DEPRECATED">Deprecated</option>
        </Select>
        <Select aria-label="Automation" value={filters.automation} onChange={(e) => set("automation", e.target.value)}>
          <option value="">Any automation</option>
          <option value="NOT_AUTOMATED">Not automated</option>
          <option value="AUTOMATED">Automated</option>
          <option value="STALE">Test out of date</option>
          <option value="WONT_AUTOMATE">Manual only</option>
        </Select>
        <Select aria-label="Latest result" value={filters.lastResult} onChange={(e) => set("lastResult", e.target.value)}>
          <option value="">Any result</option>
          <option value="PASS">Passed</option>
          <option value="FAIL">Failed</option>
          <option value="BLOCKED">Blocked</option>
          <option value="SKIPPED">Skipped</option>
          <option value="NOT_RUN">Not run</option>
        </Select>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !data ? <Skeleton className="h-64" /> : data.testCases.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={filtered ? "No test cases match these filters" : "No test cases yet"}
          description={filtered ? undefined : "Write scenarios and steps here. People can run them, and Claude can turn them into Playwright tests."}
          action={!filtered && data.permissions.canManage ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New test case</Button> : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Test case</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Automation</th>
                  <th className="px-3 py-2.5 font-medium">Latest result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.testCases.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/test-cases/${c.key}`} className="font-medium hover:text-primary hover:underline">{c.title}</Link>
                      <p className="font-mono text-[11px] text-muted-foreground">{c.key}</p>
                    </td>
                    <td className="px-3 py-2.5"><PriorityBadge name={c.priority.name} color={c.priority.color} /></td>
                    <td className="px-3 py-2.5"><CaseStatusBadge status={c.status} /></td>
                    <td className="px-3 py-2.5"><AutomationBadge testCase={c} /></td>
                    <td className="px-3 py-2.5">
                      <OutcomeBadge outcome={c.lastResult} />
                      {c.lastRunAt && <span className="ml-2 text-xs text-muted-foreground">{timeAgo(c.lastRunAt)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}

      <CaseFormDialog
        open={creating} onClose={() => setCreating(false)} meta={meta} defaultProjectId={filters.projectId || undefined}
        onSaved={(key) => router.push(`/test-cases/${key}`)}
      />
    </div>
  );
}

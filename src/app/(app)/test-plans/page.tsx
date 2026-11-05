"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Plus } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Input, Label, Select, Skeleton, Textarea } from "@/components/ui/field";
import { OutcomeBar, Pager, errorText, useTestMeta, type TestPermissions } from "@/components/test-cases/shared";
import { fmtDate } from "@/lib/utils";
import type { OutcomeCounts } from "@/lib/testcases/rules";

type Plan = {
  id: string; key: string; name: string; status: string; startDate: string | null; endDate: string | null;
  project: { key: string; name: string }; sprint: { name: string } | null; counts: OutcomeCounts;
};
type Payload = { testPlans: Plan[]; total: number; page: number; pageSize: number; permissions: TestPermissions };

export default function TestPlansPage() {
  const router = useRouter();
  const meta = useTestMeta();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ projectId: "", name: "", description: "", sprintId: "", startDate: "", endDate: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page) });
    if (projectId) p.set("projectId", projectId);
    if (status) p.set("status", status);
    try {
      setData(await api<Payload>(`/api/test-plans?${p}`));
      setError(null);
    } catch (e) {
      setError(errorText(e, "Failed to load test plans"));
    }
  }, [page, projectId, status]);
  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setForm({ projectId: projectId || meta?.projects[0]?.id || "", name: "", description: "", sprintId: "", startDate: "", endDate: "" });
    setFormError(null);
    setCreating(true);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const iso = (d: string) => (d ? new Date(d).toISOString() : undefined);
    try {
      const plan = await api<{ key: string }>("/api/test-plans", {
        method: "POST",
        json: { projectId: form.projectId, name: form.name.trim(), description: form.description || undefined, sprintId: form.sprintId || undefined, startDate: iso(form.startDate), endDate: iso(form.endDate) },
      });
      router.push(`/test-plans/${plan.key}`);
    } catch (err) {
      setFormError(errorText(err, "Could not create the test plan"));
      setSaving(false);
    }
  };

  const sprints = meta?.sprints.filter((s) => s.projectId === form.projectId) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight">Test Plans</h1>
        {data?.permissions.canManage && <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> New test plan</Button>}
      </div>

      <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
        <Select aria-label="Project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1); }}>
          <option value="">All projects</option>
          {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.key} - {p.name}</option>)}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="">All</option>
        </Select>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !data ? <Skeleton className="h-64" /> : data.testPlans.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />} title="No test plans here"
          description="A test plan groups test cases into suites for a sprint or release, and tracks which ones have passed."
          action={data.permissions.canManage ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> New test plan</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.testPlans.map((p) => (
              <Link key={p.id} href={`/test-plans/${p.key}`} className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-ring hover:shadow-md">
                <p className="font-mono text-[11px] text-muted-foreground">{p.key} · {p.project.name}</p>
                <h2 className="mt-0.5 truncate text-sm font-semibold">{p.name}</h2>
                <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
                  {p.status === "COMPLETED" ? "Completed" : "Active"}
                  {p.sprint ? ` · ${p.sprint.name}` : ""}
                  {p.startDate || p.endDate ? ` · ${fmtDate(p.startDate)} to ${fmtDate(p.endDate)}` : ""}
                </p>
                <OutcomeBar counts={p.counts} />
              </Link>
            ))}
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="New test plan" description="You can add suites and test cases next.">
        <form onSubmit={create} className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="tp-project" required>Project</Label>
            <Select id="tp-project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value, sprintId: "" })} required>
              {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.key} - {p.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="tp-name" required>Name</Label>
            <Input id="tp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={2} maxLength={120} required placeholder="e.g. Release 2.4 regression" />
          </div>
          <div>
            <Label htmlFor="tp-desc">Description</Label>
            <Textarea id="tp-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} />
          </div>
          <div>
            <Label htmlFor="tp-sprint">Sprint</Label>
            <Select id="tp-sprint" value={form.sprintId} onChange={(e) => setForm({ ...form, sprintId: e.target.value })}>
              <option value="">None</option>
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tp-start">Start date</Label>
              <Input id="tp-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tp-end">End date</Label>
              <Input id="tp-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          {formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Create test plan</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FolderTree, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Skeleton } from "@/components/ui/field";
import { useToast } from "@/components/providers";
import { AutomationBadge, OutcomeBadge, OutcomeBar, RunDialog, errorText, useTestMeta, type RunTarget, type TestPermissions } from "@/components/test-cases/shared";
import { cn, fullName } from "@/lib/utils";
import type { OutcomeCounts, Step } from "@/lib/testcases/rules";

type Suite = { id: string; parentId: string | null; name: string };
type Point = {
  id: string; suiteId: string; configuration: string; lastResult: string | null; lastBuild: string | null;
  tester: { id: string; firstName: string; lastName: string } | null;
  testCase: { key: string; title: string; status: string; steps: Step[]; automationStatus: string; stale: boolean };
};
type Detail = {
  testPlan: { key: string; name: string; description: string; status: string; project: { id: string; key: string; name: string }; sprint: { name: string } | null; counts: OutcomeCounts };
  suites: Suite[]; points: Point[]; permissions: TestPermissions;
};
type LibraryRow = { key: string; title: string; status: string };

export default function TestPlanPage() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const meta = useTestMeta();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [suiteId, setSuiteId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [mine, setMine] = useState(false);
  const [run, setRun] = useState<RunTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const [suiteForm, setSuiteForm] = useState<{ id?: string; name: string; parentId: string } | null>(null);
  const [confirm, setConfirm] = useState<"plan" | "suite" | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/api/test-plans/${key}`));
    } catch (e) {
      setError(errorText(e, "Failed to load test plan"));
    }
  }, [key]);
  useEffect(() => {
    void load();
    api<{ user: { id: string } }>("/api/auth/me").then((d) => setMe(d.user.id)).catch(() => {});
  }, [load]);

  const root = data?.suites.find((s) => s.parentId === null);
  const selected = data?.suites.find((s) => s.id === suiteId) ?? root;

  const pointCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.points ?? []) m.set(p.suiteId, (m.get(p.suiteId) ?? 0) + 1);
    return m;
  }, [data]);

  if (error) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/test-plans" className="mt-3 inline-block text-sm text-primary hover:underline">Back to test plans</Link>
      </div>
    );
  }
  if (!data || !selected) return <Skeleton className="h-96" />;
  const { testPlan: plan, permissions: perms } = data;
  const open = plan.status === "ACTIVE";
  const canEdit = perms.canManage && open;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ title: done, variant: "success" });
      await load();
    } catch (e) {
      toast({ title: errorText(e), variant: "error" });
    }
  };

  const points = data.points.filter((p) =>
    p.suiteId === selected.id &&
    (!outcome || (outcome === "NOT_RUN" ? !p.lastResult : p.lastResult === outcome)) &&
    (!mine || p.tester?.id === me)
  );

  const saveSuite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suiteForm) return;
    const { id, name, parentId } = suiteForm;
    await act(() => id
      ? api(`/api/test-suites/${id}`, { method: "PATCH", json: { name: name.trim(), ...(parentId ? { parentId } : {}) } })
      : api(`/api/test-plans/${plan.key}/suites`, { method: "POST", json: { name: name.trim(), parentId } }));
    setSuiteForm(null);
  };

  // Suites a suite may move under: anything but itself and its descendants
  const descendants = (id: string): string[] => data.suites.filter((s) => s.parentId === id).flatMap((s) => [s.id, ...descendants(s.id)]);
  const parentOptions = suiteForm?.id ? data.suites.filter((s) => s.id !== suiteForm.id && !descendants(suiteForm.id!).includes(s.id)) : data.suites;

  const renderTree = (parentId: string | null, depth: number): React.ReactNode =>
    data.suites.filter((s) => s.parentId === parentId).map((s) => (
      <li key={s.id}>
        <button
          onClick={() => setSuiteId(s.id)} aria-current={s.id === selected.id ? "true" : undefined}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors", s.id === selected.id ? "bg-muted font-medium" : "hover:bg-muted/60")}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          <span className="text-xs text-muted-foreground">{pointCount.get(s.id) ?? 0}</span>
        </button>
        <ul>{renderTree(s.id, depth + 1)}</ul>
      </li>
    ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/test-plans" className="hover:underline">Test Plans</Link> / <span className="font-mono">{plan.key}</span> · {plan.project.name}{plan.sprint ? ` · ${plan.sprint.name}` : ""}
          </p>
          <h1 className="mt-1 text-lg font-bold tracking-tight">{plan.name}{!open && <span className="ml-2 align-middle text-xs font-medium text-muted-foreground">Completed</span>}</h1>
          {plan.description && <p className="mt-1 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">{plan.description}</p>}
        </div>
        {perms.canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void act(() => api(`/api/test-plans/${plan.key}`, { method: "PATCH", json: { status: open ? "COMPLETED" : "ACTIVE" } }), open ? "Plan completed" : "Plan reopened")}>
              {open ? "Complete plan" : "Reopen plan"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm("plan")}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
          </div>
        )}
      </div>

      <section className="rounded-xl border bg-card p-4 shadow-sm"><OutcomeBar counts={plan.counts} /></section>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-xl border bg-card p-2 shadow-sm">
          <div className="flex items-center justify-between px-2 py-1.5">
            <h2 className="text-xs font-semibold text-muted-foreground">Suites</h2>
            {canEdit && <Button size="sm" variant="ghost" onClick={() => setSuiteForm({ name: "", parentId: selected.id })}><Plus className="h-3.5 w-3.5" /> Add</Button>}
          </div>
          <nav aria-label="Test suites"><ul>{renderTree(null, 0)}</ul></nav>
        </aside>

        <section className="min-w-0 rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <h2 className="mr-auto truncate text-sm font-semibold">{selected.name}</h2>
            <div className="w-36">
              <Select aria-label="Filter by outcome" className="h-8 text-xs" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="">Any outcome</option>
                <option value="NOT_RUN">Not run</option>
                <option value="PASS">Passed</option>
                <option value="FAIL">Failed</option>
                <option value="BLOCKED">Blocked</option>
                <option value="SKIPPED">Skipped</option>
              </Select>
            </div>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
            {canEdit && (
              <>
                {selected.parentId && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`Edit suite ${selected.name}`} onClick={() => setSuiteForm({ id: selected.id, name: selected.name, parentId: selected.parentId! })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete suite ${selected.name}`} onClick={() => setConfirm("suite")}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </>
                )}
                <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add test cases</Button>
              </>
            )}
          </div>

          {points.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              <FolderTree className="mx-auto mb-2 h-6 w-6" />
              {pointCount.get(selected.id) ? "No test points match these filters." : "This suite has no test cases yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Test case</th>
                    <th className="px-3 py-2.5 font-medium">Configuration</th>
                    <th className="px-3 py-2.5 font-medium">Tester</th>
                    <th className="px-3 py-2.5 font-medium">Outcome</th>
                    <th className="px-3 py-2.5 font-medium">Build</th>
                    <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {points.map((p) => {
                    const canRun = perms.canExecute && open && p.testCase.status !== "DEPRECATED";
                    return (
                      <tr key={p.id} className="hover:bg-muted/40">
                        <td className="px-4 py-2.5">
                          <Link href={`/test-cases/${p.testCase.key}`} className="font-medium hover:text-primary hover:underline">{p.testCase.title}</Link>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                            {p.testCase.key}
                            {p.testCase.status === "DEPRECATED" && <span className="font-sans">Deprecated</span>}
                            <AutomationBadge testCase={p.testCase} />
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{p.configuration || <span className="text-muted-foreground">None</span>}</td>
                        <td className="px-3 py-2.5 text-xs">
                          {canEdit ? (
                            <div className="w-40">
                              <Select
                                aria-label={`Tester for ${p.testCase.key}`} className="h-8 text-xs" value={p.tester?.id ?? ""}
                                onChange={(e) => void act(() => api(`/api/test-points/${p.id}`, { method: "PATCH", json: { testerId: e.target.value || null } }))}
                              >
                                <option value="">Unassigned</option>
                                {meta?.users.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
                              </Select>
                            </div>
                          ) : p.tester ? fullName(p.tester) : <span className="text-muted-foreground">Unassigned</span>}
                        </td>
                        <td className="px-3 py-2.5"><OutcomeBadge outcome={p.lastResult} /></td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.lastBuild ?? ""}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-1">
                            {canRun && (
                              <Button size="sm" variant="outline" onClick={() => setRun({ key: p.testCase.key, title: p.testCase.title, steps: p.testCase.steps, projectId: plan.project.id, pointId: p.id, configuration: p.configuration || undefined })}>
                                <Play className="h-3 w-3" /> Run
                              </Button>
                            )}
                            {canEdit && (
                              <Button size="icon" variant="ghost" aria-label={`Remove ${p.testCase.key} from this suite`} onClick={() => void act(() => api(`/api/test-points/${p.id}`, { method: "DELETE" }), "Removed from suite")}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Dialog open={Boolean(suiteForm)} onClose={() => setSuiteForm(null)} title={suiteForm?.id ? "Edit suite" : "New suite"}>
        {suiteForm && (
          <form onSubmit={saveSuite} className="space-y-4 px-5 py-4">
            <div>
              <Label htmlFor="suite-name" required>Name</Label>
              <Input id="suite-name" value={suiteForm.name} onChange={(e) => setSuiteForm({ ...suiteForm, name: e.target.value })} minLength={2} maxLength={120} required />
            </div>
            <div>
              <Label htmlFor="suite-parent">Inside</Label>
              <Select id="suite-parent" value={suiteForm.parentId} onChange={(e) => setSuiteForm({ ...suiteForm, parentId: e.target.value })}>
                {parentOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSuiteForm(null)}>Cancel</Button>
              <Button type="submit">{suiteForm.id ? "Save" : "Add suite"}</Button>
            </div>
          </form>
        )}
      </Dialog>

      <AddCasesDialog
        open={adding} onClose={() => setAdding(false)} suite={selected} projectId={plan.project.id} users={meta?.users ?? []}
        onAdded={(msg) => { setAdding(false); toast({ title: msg, variant: "success" }); void load(); }}
      />
      <RunDialog target={run} onClose={() => setRun(null)} meta={meta} canCreateTicket={perms.canCreateTicket} onDone={() => { setRun(null); void load(); toast({ title: "Result saved", variant: "success" }); }} />
      <ConfirmDialog
        open={confirm === "suite"} onClose={() => setConfirm(null)} danger confirmLabel="Delete suite"
        title={`Delete suite ${selected.name}?`} message="Its child suites and test points are removed too. Test cases and their result history are kept."
        onConfirm={() => { const id = selected.id; setSuiteId(null); void act(() => api(`/api/test-suites/${id}`, { method: "DELETE" }), "Suite deleted"); }}
      />
      <ConfirmDialog
        open={confirm === "plan"} onClose={() => setConfirm(null)} danger confirmLabel="Delete plan"
        title={`Delete ${plan.key}?`} message="The plan, its suites and its test points are removed. Test cases and their result history are kept."
        onConfirm={() => void api(`/api/test-plans/${plan.key}`, { method: "DELETE" }).then(() => router.push("/test-plans")).catch((e) => toast({ title: errorText(e), variant: "error" }))}
      />
    </div>
  );
}

function AddCasesDialog({ open, onClose, suite, projectId, users, onAdded }: {
  open: boolean; onClose: () => void; suite: Suite; projectId: string; users: { id: string; firstName: string; lastName: string }[]; onAdded: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState("");
  const [testerId, setTesterId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setSelected(new Set()); setConfigs(""); setTesterId(""); setError(null); setQ(""); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams({ projectId, pageSize: "100" });
      if (q.trim()) p.set("q", q.trim());
      api<{ testCases: LibraryRow[] }>(`/api/test-cases?${p}`)
        .then((d) => setRows(d.testCases.filter((c) => c.status !== "DEPRECATED")))
        .catch((e) => setError(errorText(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [open, q, projectId]);

  const toggle = (key: string) => setSelected((s) => {
    const next = new Set(s);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const configurations = configs.split(",").map((c) => c.trim()).filter(Boolean);
      const r = await api<{ added: number; skipped: number }>(`/api/test-suites/${suite.id}/points`, {
        method: "POST",
        json: { testCaseKeys: [...selected], configurations, testerId: testerId || undefined },
      });
      onAdded(`Added ${r.added} test point${r.added === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} already in this suite` : ""}`);
    } catch (err) {
      setError(errorText(err, "Could not add test cases"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title={`Add test cases to ${suite.name}`} description="A test point is created for each test case and configuration.">
      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        <Input aria-label="Search the library" placeholder="Search title or key" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto rounded-lg border">
          {!rows ? <Skeleton className="m-3 h-20" /> : rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No test cases found. <Link href="/test-cases" className="text-primary hover:underline">Create some in the library.</Link>
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((c) => (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/40">
                    <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
                    <span className="font-mono text-[11px] text-muted-foreground">{c.key}</span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="add-configs">Configurations</Label>
            <Input id="add-configs" value={configs} onChange={(e) => setConfigs(e.target.value)} placeholder="Chrome, Edge (optional)" />
          </div>
          <div>
            <Label htmlFor="add-tester">Tester</Label>
            <Select id="add-tester" value={testerId} onChange={(e) => setTesterId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </Select>
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={selected.size === 0}>Add {selected.size || ""} test case{selected.size === 1 ? "" : "s"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

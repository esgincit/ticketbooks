"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Play, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Skeleton } from "@/components/ui/field";
import { PriorityBadge } from "@/components/tickets/badges";
import { useToast } from "@/components/providers";
import { AutomationBadge, CaseFormDialog, CaseStatusBadge, OutcomeBadge, RunDialog, errorText, useTestMeta, type RunTarget, type TestPermissions } from "@/components/test-cases/shared";
import { fmtDateTime, fullName } from "@/lib/utils";
import type { Step, StepResult } from "@/lib/testcases/rules";

type UserRef = { id: string; firstName: string; lastName: string };
type Detail = {
  testCase: {
    id: string; key: string; title: string; preconditions: string; steps: Step[]; tags: string[]; status: string; version: number;
    automationStatus: string; automationRef: string | null; automatedVersion: number | null; stale: boolean; lastResult: string | null;
    project: { id: string; key: string; name: string }; priority: { id: string; name: string; color: string }; owner: UserRef | null;
    tickets: { id: string; key: string; title: string; status: { name: string } }[];
    plans: { key: string; name: string; status: string }[];
  };
  results: {
    id: string; outcome: string; source: string; notes: string; buildVersion: string | null; executedAt: string; executedBy: UserRef | null;
    stepResults: StepResult[] | null; bugTicket: { key: string; title: string } | null;
    point: { configuration: string; suite: { name: string; plan: { key: string; name: string } } } | null;
  }[];
  permissions: TestPermissions;
};

export default function TestCasePage() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const meta = useTestMeta();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [run, setRun] = useState<RunTarget | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/api/test-cases/${key}`));
    } catch (e) {
      setError(errorText(e, "Failed to load test case"));
    }
  }, [key]);
  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/test-cases" className="mt-3 inline-block text-sm text-primary hover:underline">Back to test cases</Link>
      </div>
    );
  }
  if (!data) return <Skeleton className="h-96" />;
  const { testCase: c, results, permissions: p } = data;

  const remove = async () => {
    try {
      await api(`/api/test-cases/${c.key}`, { method: "DELETE" });
      toast({ title: `${c.key} deleted`, variant: "success" });
      router.push("/test-cases");
    } catch (e) {
      toast({ title: errorText(e), variant: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/test-cases" className="hover:underline">Test Cases</Link> / <span className="font-mono">{c.key}</span> · {c.project.name} · Version {c.version}
          </p>
          <h1 className="mt-1 text-lg font-bold tracking-tight">{c.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <CaseStatusBadge status={c.status} />
            <PriorityBadge name={c.priority.name} color={c.priority.color} />
            <AutomationBadge testCase={c} />
            <OutcomeBadge outcome={c.lastResult} />
          </div>
        </div>
        <div className="flex gap-2">
          {p.canExecute && c.status !== "DEPRECATED" && (
            <Button size="sm" onClick={() => setRun({ key: c.key, title: c.title, steps: c.steps, projectId: c.project.id })}><Play className="h-3.5 w-3.5" /> Run</Button>
          )}
          {p.canManage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
          {p.canManage && <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {c.preconditions && (
            <section className="rounded-xl border bg-card p-4 shadow-sm">
              <h2 className="mb-1.5 text-sm font-semibold">Preconditions</h2>
              <p className="whitespace-pre-wrap text-sm">{c.preconditions}</p>
            </section>
          )}

          <section className="rounded-xl border bg-card shadow-sm">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Steps</h2>
            {c.steps.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No steps yet.</p> : (
              <ol className="divide-y">
                {c.steps.map((s, i) => (
                  <li key={i} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[28px_1fr_1fr]">
                    <span className="font-medium text-muted-foreground">{i + 1}</span>
                    <div>
                      <p className="whitespace-pre-wrap">{s.action}</p>
                      {s.data && <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{s.data}</p>}
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">{s.expected}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-xl border bg-card shadow-sm">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Run history</h2>
            {results.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">This test hasn't been run yet.</p> : (
              <ul className="divide-y">
                {results.map((r) => (
                  <li key={r.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <OutcomeBadge outcome={r.outcome} />
                      <span className="text-xs text-muted-foreground">
                        {fmtDateTime(r.executedAt)}{r.executedBy ? ` · ${fullName(r.executedBy)}` : ""} · {r.source === "AUTOMATED" ? "Automated" : "Manual"}
                        {r.buildVersion ? ` · Build ${r.buildVersion}` : ""}
                        {r.point ? ` · ${r.point.suite.plan.key}${r.point.configuration ? ` · ${r.point.configuration}` : ""}` : ""}
                      </span>
                      {r.bugTicket && <Link href={`/tickets/${r.bugTicket.key}`} className="text-xs text-primary hover:underline">Bug {r.bugTicket.key}</Link>}
                    </div>
                    {r.notes && <p className="mt-1.5 whitespace-pre-wrap text-xs">{r.notes}</p>}
                    {r.stepResults && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-muted-foreground">Step results</summary>
                        <ol className="mt-1.5 space-y-1">
                          {r.stepResults.map((s, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-2 text-xs">
                              <OutcomeBadge outcome={s.outcome} />
                              <span>{i + 1}. {s.action}</span>
                              {s.comment && <span className="text-muted-foreground">{s.comment}</span>}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <AutomationPanel testCase={c} canEdit={p.canExecute} onSaved={load} />
          <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
            <h2 className="mb-2 font-semibold">Details</h2>
            <p className="text-xs text-muted-foreground">Owner</p>
            <p className="mb-2">{c.owner ? fullName(c.owner) : "None"}</p>
            <p className="text-xs text-muted-foreground">Tags</p>
            <p className="mb-2">{c.tags.length ? c.tags.join(", ") : "None"}</p>
            <p className="text-xs text-muted-foreground">Linked tickets</p>
            {c.tickets.length === 0 ? <p className="mb-2">None</p> : (
              <ul className="mb-2 space-y-1">
                {c.tickets.map((t) => <li key={t.id}><Link href={`/tickets/${t.key}`} className="text-primary hover:underline">{t.key}</Link> <span className="text-xs text-muted-foreground">{t.title}</span></li>)}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Test plans</p>
            {c.plans.length === 0 ? <p>None</p> : (
              <ul className="space-y-1">
                {c.plans.map((pl) => <li key={pl.key}><Link href={`/test-plans/${pl.key}`} className="text-primary hover:underline">{pl.key}</Link> <span className="text-xs text-muted-foreground">{pl.name}</span></li>)}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <CaseFormDialog open={editing} onClose={() => setEditing(false)} meta={meta} testCase={c} onSaved={() => { setEditing(false); void load(); }} />
      <RunDialog target={run} onClose={() => setRun(null)} meta={meta} canCreateTicket={p.canCreateTicket} onDone={() => { setRun(null); void load(); toast({ title: "Result saved", variant: "success" }); }} />
      <ConfirmDialog
        open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void remove()} danger
        title={`Delete ${c.key}?`} message="It will be removed from the library and from any test plans. Its result history is kept." confirmLabel="Delete"
      />
    </div>
  );
}

function AutomationPanel({ testCase: c, canEdit, onSaved }: { testCase: Detail["testCase"]; canEdit: boolean; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(c.automationStatus);
  const [ref, setRef] = useState(c.automationRef ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStatus(c.automationStatus); setRef(c.automationRef ?? ""); }, [c.automationStatus, c.automationRef]);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/test-cases/${c.key}/automation`, {
        method: "PATCH",
        json: { automationStatus: status, ...(status === "AUTOMATED" ? { automationRef: ref.trim(), version: c.version } : {}) },
      });
      toast({ title: "Automation updated", variant: "success" });
      await onSaved();
    } catch (e) {
      toast({ title: errorText(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
      <h2 className="mb-2 font-semibold">Automation</h2>
      {c.stale && (
        <p role="status" className="mb-3 flex gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>This case changed after its test was written (test is from version {c.automatedVersion}, case is version {c.version}). Update the test, then save to mark it current.</span>
        </p>
      )}
      {canEdit ? (
        <div className="space-y-2.5">
          <div>
            <Label htmlFor="auto-status">Status</Label>
            <Select id="auto-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="NOT_AUTOMATED">Not automated</option>
              <option value="AUTOMATED">Automated</option>
              <option value="WONT_AUTOMATE">Manual only</option>
            </Select>
          </div>
          {status === "AUTOMATED" && (
            <div>
              <Label htmlFor="auto-ref" required>Test location</Label>
              <Input id="auto-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={500} placeholder="tests/login.spec.ts > user signs in" />
            </div>
          )}
          <Button size="sm" variant="outline" loading={busy} disabled={status === "AUTOMATED" && !ref.trim()} onClick={() => void save()}>
            {status === "AUTOMATED" ? `Save as matching version ${c.version}` : "Save"}
          </Button>
        </div>
      ) : (
        <p className="break-words text-xs text-muted-foreground">{c.automationRef ?? "No automated test linked."}</p>
      )}
    </section>
  );
}

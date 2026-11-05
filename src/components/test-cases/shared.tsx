"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { CASE_STATUSES, OUTCOMES, suggestOutcome, type Outcome, type OutcomeCounts, type Step } from "@/lib/testcases/rules";

export type TestMeta = {
  projects: { id: string; key: string; name: string }[];
  priorities: { id: string; name: string; isDefault: boolean }[];
  users: { id: string; firstName: string; lastName: string }[];
  types: { id: string; name: string; isSubtask: boolean }[];
  sprints: { id: string; name: string; projectId: string }[];
};
export type TestPermissions = { canManage: boolean; canExecute: boolean; canCreateTicket: boolean };

export function useTestMeta() {
  const [meta, setMeta] = useState<TestMeta | null>(null);
  useEffect(() => { api<TestMeta>("/api/meta").then(setMeta).catch(() => {}); }, []);
  return meta;
}

export const errorText = (e: unknown, fallback = "Something went wrong") => (e instanceof ApiError ? e.message : fallback);

const OUTCOME_STYLE: Record<string, { label: string; badge: string; bar: string }> = {
  PASS: { label: "Passed", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500" },
  FAIL: { label: "Failed", badge: "bg-red-500/15 text-red-700 dark:text-red-400", bar: "bg-red-500" },
  BLOCKED: { label: "Blocked", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400", bar: "bg-amber-500" },
  SKIPPED: { label: "Skipped", badge: "bg-slate-500/15 text-slate-700 dark:text-slate-300", bar: "bg-slate-400" },
};
const CHIP = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium";

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  const style = outcome ? OUTCOME_STYLE[outcome] : undefined;
  return <span className={cn(CHIP, style?.badge ?? "bg-muted text-muted-foreground")}>{style?.label ?? "Not run"}</span>;
}

const CASE_STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", READY: "Ready", DEPRECATED: "Deprecated" };
export function CaseStatusBadge({ status }: { status: string }) {
  return <span className={cn(CHIP, status === "READY" ? "bg-blue-500/15 text-blue-700 dark:text-blue-400" : "bg-muted text-muted-foreground")}>{CASE_STATUS_LABEL[status] ?? status}</span>;
}

export function AutomationBadge({ testCase }: { testCase: { automationStatus: string; stale?: boolean } }) {
  if (testCase.stale) return <span className={cn(CHIP, "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>Test out of date</span>;
  if (testCase.automationStatus === "AUTOMATED") return <span className={cn(CHIP, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400")}>Automated</span>;
  if (testCase.automationStatus === "WONT_AUTOMATE") return <span className={cn(CHIP, "bg-muted text-muted-foreground")}>Manual only</span>;
  return <span className={cn(CHIP, "bg-muted text-muted-foreground")}>Not automated</span>;
}

/** Stacked progress bar with a text summary, so the numbers don't rely on colour alone */
export function OutcomeBar({ counts }: { counts: OutcomeCounts }) {
  const parts = OUTCOMES.filter((o) => counts[o] > 0);
  const summary = parts.map((o) => `${counts[o]} ${OUTCOME_STYLE[o].label.toLowerCase()}`);
  if (counts.NOT_RUN > 0) summary.push(`${counts.NOT_RUN} not run`);
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {parts.map((o) => <div key={o} className={OUTCOME_STYLE[o].bar} style={{ width: `${(counts[o] / counts.total) * 100}%` }} />)}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{counts.total === 0 ? "No test points yet" : summary.join(" · ")}</p>
    </div>
  );
}

export function StepsEditor({ steps, onChange }: { steps: Step[]; onChange: (steps: Step[]) => void }) {
  const update = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="rounded-lg border p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
            <div className="flex gap-0.5">
              <Button type="button" variant="ghost" size="icon" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Textarea aria-label={`Step ${i + 1} action`} className="min-h-[60px]" placeholder="Action: what to do" maxLength={5000} value={s.action} onChange={(e) => update(i, { action: e.target.value })} />
            <Textarea aria-label={`Step ${i + 1} expected result`} className="min-h-[60px]" placeholder="Expected result" maxLength={5000} value={s.expected} onChange={(e) => update(i, { expected: e.target.value })} />
          </div>
          <Input aria-label={`Step ${i + 1} test data`} className="mt-2" placeholder="Test data (optional). Name an environment variable for passwords." maxLength={5000} value={s.data ?? ""} onChange={(e) => update(i, { data: e.target.value })} />
        </div>
      ))}
      {steps.length < 100 && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...steps, { action: "", expected: "" }])}><Plus className="h-3.5 w-3.5" /> Add step</Button>
      )}
    </div>
  );
}

export type EditableCase = {
  key: string; title: string; preconditions: string; steps: Step[]; tags: string[];
  priority: { id: string }; status: string; project: { id: string };
  tickets?: { key: string }[];
};

const splitList = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** Create (no testCase) or edit a test case */
export function CaseFormDialog({ open, onClose, onSaved, meta, testCase, defaultProjectId }: {
  open: boolean; onClose: () => void; onSaved: (key: string) => void; meta: TestMeta | null; testCase?: EditableCase; defaultProjectId?: string;
}) {
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [preconditions, setPreconditions] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [tags, setTags] = useState("");
  const [priorityId, setPriorityId] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [ticketKeys, setTicketKeys] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProjectId(testCase?.project.id ?? defaultProjectId ?? meta?.projects[0]?.id ?? "");
    setTitle(testCase?.title ?? "");
    setPreconditions(testCase?.preconditions ?? "");
    setSteps(testCase?.steps ?? [{ action: "", expected: "" }]);
    setTags(testCase?.tags.join(", ") ?? "");
    setPriorityId(testCase?.priority.id ?? meta?.priorities.find((p) => p.isDefault)?.id ?? "");
    setStatus(testCase?.status ?? "DRAFT");
    setTicketKeys(testCase?.tickets?.map((t) => t.key).join(", ") ?? "");
  }, [open, testCase, meta, defaultProjectId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSteps = steps
      .map((s) => ({ action: s.action.trim(), expected: s.expected.trim(), ...(s.data?.trim() ? { data: s.data.trim() } : {}) }))
      .filter((s) => s.action || s.expected || s.data);
    if (cleanSteps.some((s) => !s.action)) return setError("Every step needs an action");
    setSaving(true);
    setError(null);
    const body = { title: title.trim(), preconditions, steps: cleanSteps, tags: splitList(tags), priorityId: priorityId || undefined, status, ticketKeys: splitList(ticketKeys) };
    try {
      const saved = testCase
        ? await api<{ key: string }>(`/api/test-cases/${testCase.key}`, { method: "PATCH", json: body })
        : await api<{ key: string }>("/api/test-cases", { method: "POST", json: { ...body, projectId } });
      onSaved(saved.key);
    } catch (err) {
      setError(errorText(err, "Could not save the test case"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title={testCase ? `Edit ${testCase.key}` : "New test case"} description="Steps should be specific enough for a person or Claude to follow exactly.">
      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        {!testCase && (
          <div>
            <Label htmlFor="tc-project" required>Project</Label>
            <Select id="tc-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.key} - {p.name}</option>)}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="tc-title" required>Title</Label>
          <Input id="tc-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={300} required />
        </div>
        <div>
          <Label htmlFor="tc-pre">Preconditions</Label>
          <Textarea id="tc-pre" value={preconditions} onChange={(e) => setPreconditions(e.target.value)} maxLength={5000} placeholder="What must be true before the first step" />
        </div>
        <div>
          <Label>Steps</Label>
          <StepsEditor steps={steps} onChange={setSteps} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="tc-priority">Priority</Label>
            <Select id="tc-priority" value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
              {meta?.priorities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="tc-status">Status</Label>
            <Select id="tc-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {CASE_STATUSES.map((s) => <option key={s} value={s}>{CASE_STATUS_LABEL[s]}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="tc-tags">Tags</Label>
            <Input id="tc-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="smoke, login" />
          </div>
          <div>
            <Label htmlFor="tc-tickets">Linked tickets</Label>
            <Input id="tc-tickets" value={ticketKeys} onChange={(e) => setTicketKeys(e.target.value)} placeholder="OPS-1042, OPS-1043" />
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{testCase ? "Save changes" : "Create test case"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type RunTarget = {
  key: string; title: string; steps: Step[]; projectId: string;
  pointId?: string; configuration?: string;
};

/** Run a test: step-by-step outcomes, overall outcome, and optionally a bug ticket */
export function RunDialog({ target, onClose, onDone, meta, canCreateTicket }: {
  target: RunTarget | null; onClose: () => void; onDone: () => void; meta: TestMeta | null; canCreateTicket: boolean;
}) {
  const [stepOutcomes, setStepOutcomes] = useState<(Outcome | undefined)[]>([]);
  const [comments, setComments] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [notes, setNotes] = useState("");
  const [build, setBuild] = useState("");
  const [bugKey, setBugKey] = useState("");
  const [fileBug, setFileBug] = useState(false);
  const [bugTitle, setBugTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setStepOutcomes(target.steps.map(() => undefined));
    setComments(target.steps.map(() => ""));
    setOutcome(""); setNotes(""); setBuild(""); setBugKey(""); setFileBug(false); setError(null);
    setBugTitle(`Test failed: ${target.title}`.slice(0, 300));
  }, [target]);

  if (!target) return null;

  const setStep = (i: number, value: Outcome) => {
    const next = stepOutcomes.map((o, j) => (j === i ? (o === value ? undefined : value) : o));
    setStepOutcomes(next);
    const suggested = suggestOutcome(next);
    if (suggested) setOutcome(suggested);
  };

  const createBug = async () => {
    const type = meta?.types.find((t) => /bug/i.test(t.name) && !t.isSubtask) ?? meta?.types.find((t) => !t.isSubtask);
    if (!type) throw new Error("No ticket type available");
    const failed = target.steps
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => stepOutcomes[i] === "FAIL")
      .map(({ s, i }) => `<li><b>Step ${i + 1}:</b> ${escapeHtml(s.action)}<br/>Expected: ${escapeHtml(s.expected)}${comments[i] ? `<br/>Actual: ${escapeHtml(comments[i])}` : ""}</li>`)
      .join("");
    const description = `<p>Found while running ${escapeHtml(target.key)}${target.configuration ? ` on ${escapeHtml(target.configuration)}` : ""}${build ? ` (build ${escapeHtml(build)})` : ""}.</p>${failed ? `<ul>${failed}</ul>` : ""}${notes ? `<p>${escapeHtml(notes)}</p>` : ""}`;
    const created = await api<{ key: string }>("/api/tickets", { method: "POST", json: { projectId: target.projectId, typeId: type.id, title: bugTitle.trim(), description } });
    return created.key;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) return setError("Choose an overall outcome");
    setSaving(true);
    setError(null);
    let bugTicketKey = bugKey.trim() || undefined;
    try {
      if (fileBug && !bugTicketKey) {
        bugTicketKey = await createBug();
        // If recording fails below, a retry reuses this ticket rather than filing a second one
        setBugKey(bugTicketKey);
        setFileBug(false);
      }
      const complete = stepOutcomes.length > 0 && stepOutcomes.every(Boolean);
      await api("/api/test-results", {
        method: "POST",
        json: {
          ...(target.pointId ? { pointId: target.pointId } : { key: target.key }),
          outcome, source: "MANUAL", notes: notes || undefined, buildVersion: build.trim() || undefined, bugTicketKey,
          stepResults: complete ? stepOutcomes.map((o, i) => ({ outcome: o, comment: comments[i] || undefined })) : undefined,
        },
      });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not record the result"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} width="max-w-2xl" title={`Run ${target.key}${target.configuration ? ` on ${target.configuration}` : ""}`} description={target.title}>
      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        {target.steps.length > 0 && (
          <ol className="space-y-2">
            {target.steps.map((s, i) => (
              <li key={i} className="rounded-lg border p-2.5 text-sm">
                <p className="whitespace-pre-wrap"><b>{i + 1}.</b> {s.action}</p>
                {s.expected && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">Expected: {s.expected}</p>}
                {s.data && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">Data: {s.data}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label={`Outcome of step ${i + 1}`}>
                  {OUTCOMES.map((o) => (
                    <button
                      key={o} type="button" aria-pressed={stepOutcomes[i] === o} onClick={() => setStep(i, o)}
                      className={cn("rounded-md border px-2 py-1 text-[11px] font-medium transition-colors", stepOutcomes[i] === o ? OUTCOME_STYLE[o].badge : "text-muted-foreground hover:bg-muted")}
                    >
                      {OUTCOME_STYLE[o].label}
                    </button>
                  ))}
                  <Input aria-label={`Comment on step ${i + 1}`} className="ml-1 h-7 min-w-32 flex-1 text-xs" placeholder="Comment" maxLength={5000} value={comments[i] ?? ""} onChange={(e) => setComments(comments.map((c, j) => (j === i ? e.target.value : c)))} />
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="run-outcome" required>Overall outcome</Label>
            <Select id="run-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} required>
              <option value="">Choose...</option>
              {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_STYLE[o].label}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="run-build">Build or version</Label>
            <Input id="run-build" value={build} onChange={(e) => setBuild(e.target.value)} maxLength={100} />
          </div>
        </div>
        <div>
          <Label htmlFor="run-notes">Notes</Label>
          <Textarea id="run-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </div>
        {(outcome === "FAIL" || outcome === "BLOCKED") && (
          <div className="space-y-2 rounded-lg border p-3">
            {canCreateTicket && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fileBug} disabled={Boolean(bugKey.trim())} onChange={(e) => setFileBug(e.target.checked)} /> File a new bug ticket
              </label>
            )}
            {fileBug ? (
              <div>
                <Label htmlFor="run-bug-title" required>Bug title</Label>
                <Input id="run-bug-title" value={bugTitle} onChange={(e) => setBugTitle(e.target.value)} minLength={3} maxLength={300} required />
              </div>
            ) : (
              <div>
                <Label htmlFor="run-bug-key">Existing bug ticket (optional)</Label>
                <Input id="run-bug-key" value={bugKey} onChange={(e) => setBugKey(e.target.value)} placeholder="OPS-1042" />
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Save result</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>{(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

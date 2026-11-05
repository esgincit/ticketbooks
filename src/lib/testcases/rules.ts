/** Pure test-management rules, shared by the service and the web UI. No database access. */

export const OUTCOMES = ["PASS", "FAIL", "BLOCKED", "SKIPPED"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const CASE_STATUSES = ["DRAFT", "READY", "DEPRECATED"] as const;
export const AUTOMATION_STATUSES = ["NOT_AUTOMATED", "AUTOMATED", "WONT_AUTOMATE"] as const;
export const PLAN_STATUSES = ["ACTIVE", "COMPLETED"] as const;
export const MAX_SUITE_DEPTH = 10;

export type Step = { action: string; expected: string; data?: string };
export type StepInput = { outcome: Outcome; comment?: string };
export type StepResult = Step & { outcome: Outcome; comment: string };
export type CaseContent = { title: string; preconditions: string; steps: Step[] };

/** An automated test is stale once the case has changed since the version it was written from */
export function isStale(c: { automationStatus: string; version: number; automatedVersion: number | null }): boolean {
  return c.automationStatus === "AUTOMATED" && c.automatedVersion !== null && c.version > c.automatedVersion;
}

const contentKey = (c: CaseContent) =>
  JSON.stringify([c.title, c.preconditions, c.steps.map((s) => [s.action, s.expected, s.data ?? ""])]);

/** Only title, preconditions and steps affect the generated test. Tags, status and owner do not. */
export function contentChanged(before: CaseContent, after: CaseContent): boolean {
  return contentKey(before) !== contentKey(after);
}

/** One changed field in a history entry. Long values are clipped: history says what changed, it isn't a backup. */
export type Change = { field: string; from: string | null; to: string | null };
const clip = (s: string) => (s.length > 500 ? `${s.slice(0, 500)}…` : s);

export function change(field: string, from: string | null | undefined, to: string | null | undefined): Change[] {
  const a = from || null;
  const b = to || null;
  return a === b ? [] : [{ field, from: a && clip(a), to: b && clip(b) }];
}

const stepText = (s: Step) => [s.action, s.expected && `Expected: ${s.expected}`, s.data && `Data: ${s.data}`].filter(Boolean).join("\n");

/** Compared by position, so moving a step shows as a change to each position it affects */
export function stepChanges(before: Step[], after: Step[]): Change[] {
  return Array.from({ length: Math.max(before.length, after.length) }, (_, i) =>
    change(`Step ${i + 1}`, before[i] && stepText(before[i]), after[i] && stepText(after[i]))
  ).flat();
}

/** Snapshot of steps with their outcomes, so history stays correct after the case is edited */
export function buildStepResults(steps: Step[], input: StepInput[]): StepResult[] | null {
  if (input.length !== steps.length) return null;
  return steps.map((s, i) => ({ ...s, outcome: input[i].outcome, comment: input[i].comment ?? "" }));
}

/** Overall outcome the UI suggests from step outcomes */
export function suggestOutcome(outcomes: (Outcome | undefined)[]): Outcome | undefined {
  if (outcomes.includes("FAIL")) return "FAIL";
  if (outcomes.includes("BLOCKED")) return "BLOCKED";
  if (outcomes.length > 0 && outcomes.every((o) => o === "PASS")) return "PASS";
  if (outcomes.length > 0 && outcomes.every((o) => o === "SKIPPED")) return "SKIPPED";
  return undefined;
}

export type SuiteNode = { id: string; parentId: string | null };

/**
 * Checks placing a suite under a parent. `movingId` is null for a new suite.
 * Returns a message when the placement is not allowed.
 */
export function suitePlacementError(suites: SuiteNode[], movingId: string | null, parentId: string): string | null {
  const byId = new Map(suites.map((s) => [s.id, s]));
  let depth = 0;
  for (let cur = byId.get(parentId); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    if (cur.id === movingId) return "A suite cannot be moved inside itself";
    depth += 1;
    if (depth > suites.length) return "Suite tree is invalid";
  }
  if (depth === 0) return "Parent suite is not in this plan";

  const height = (id: string): number =>
    1 + Math.max(0, ...suites.filter((s) => s.parentId === id).map((s) => height(s.id)));
  if (depth + (movingId ? height(movingId) : 1) > MAX_SUITE_DEPTH) return `Suites can be nested at most ${MAX_SUITE_DEPTH} levels deep`;
  return null;
}

export type OutcomeCounts = Record<Outcome | "NOT_RUN", number> & { total: number };

export function countOutcomes(points: { lastResult: string | null }[]): OutcomeCounts {
  const counts: OutcomeCounts = { PASS: 0, FAIL: 0, BLOCKED: 0, SKIPPED: 0, NOT_RUN: 0, total: points.length };
  for (const p of points) {
    const k = (OUTCOMES as readonly string[]).includes(p.lastResult ?? "") ? (p.lastResult as Outcome) : "NOT_RUN";
    counts[k] += 1;
  }
  return counts;
}

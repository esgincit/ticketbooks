import { describe, it, expect } from "vitest";
import { buildStepResults, contentChanged, countOutcomes, isStale, suggestOutcome, suitePlacementError } from "@/lib/testcases/rules";

describe("isStale", () => {
  it("is stale only when automated from an older version", () => {
    expect(isStale({ automationStatus: "AUTOMATED", version: 2, automatedVersion: 1 })).toBe(true);
    expect(isStale({ automationStatus: "AUTOMATED", version: 2, automatedVersion: 2 })).toBe(false);
    expect(isStale({ automationStatus: "NOT_AUTOMATED", version: 2, automatedVersion: null })).toBe(false);
  });
});

describe("contentChanged", () => {
  const base = { title: "T", preconditions: "P", steps: [{ action: "a", expected: "e" }] };
  it("ignores identical content, including a missing vs empty data field", () => {
    expect(contentChanged(base, { ...base, steps: [{ action: "a", expected: "e", data: "" }] })).toBe(false);
  });
  it("sees changes to title, preconditions, steps and step order", () => {
    expect(contentChanged(base, { ...base, title: "X" })).toBe(true);
    expect(contentChanged(base, { ...base, preconditions: "X" })).toBe(true);
    expect(contentChanged(base, { ...base, steps: [{ action: "a", expected: "changed" }] })).toBe(true);
    const two = { ...base, steps: [{ action: "a", expected: "" }, { action: "b", expected: "" }] };
    expect(contentChanged(two, { ...two, steps: [...two.steps].reverse() })).toBe(true);
  });
});

describe("buildStepResults", () => {
  it("snapshots steps with outcomes", () => {
    expect(buildStepResults([{ action: "a", expected: "e" }], [{ outcome: "PASS" }])).toEqual([{ action: "a", expected: "e", outcome: "PASS", comment: "" }]);
  });
  it("rejects a length mismatch", () => {
    expect(buildStepResults([{ action: "a", expected: "e" }], [])).toBeNull();
  });
});

describe("suggestOutcome", () => {
  it("lets a failure win, then blocked, and needs every step for a pass", () => {
    expect(suggestOutcome(["PASS", "FAIL", "BLOCKED"])).toBe("FAIL");
    expect(suggestOutcome(["PASS", "BLOCKED"])).toBe("BLOCKED");
    expect(suggestOutcome(["PASS", "PASS"])).toBe("PASS");
    expect(suggestOutcome(["PASS", undefined])).toBeUndefined();
    expect(suggestOutcome([])).toBeUndefined();
  });
});

describe("suitePlacementError", () => {
  const tree = [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "root" },
  ];
  it("allows valid moves and new suites", () => {
    expect(suitePlacementError(tree, "b", "c")).toBeNull();
    expect(suitePlacementError(tree, null, "b")).toBeNull();
  });
  it("rejects cycles and foreign parents", () => {
    expect(suitePlacementError(tree, "a", "b")).toMatch(/inside itself/);
    expect(suitePlacementError(tree, "a", "a")).toMatch(/inside itself/);
    expect(suitePlacementError(tree, "a", "other-plan")).toMatch(/not in this plan/);
  });
  it("enforces the depth limit, counting the moved subtree", () => {
    const chain = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, parentId: i ? `s${i - 1}` : null }));
    expect(suitePlacementError(chain, null, "s8")).toBeNull(); // becomes level 10
    expect(suitePlacementError(chain, null, "s9")).toMatch(/at most 10/);
    const withBranch = [...chain.slice(0, 9), { id: "x", parentId: "s0" }, { id: "y", parentId: "x" }];
    expect(suitePlacementError(withBranch, "x", "s8")).toMatch(/at most 10/); // 9 + 2 levels
  });
});

describe("countOutcomes", () => {
  it("counts each outcome, and treats null as not run", () => {
    expect(countOutcomes([{ lastResult: "PASS" }, { lastResult: "PASS" }, { lastResult: "FAIL" }, { lastResult: null }]))
      .toEqual({ PASS: 2, FAIL: 1, BLOCKED: 0, SKIPPED: 0, NOT_RUN: 1, total: 4 });
  });
});

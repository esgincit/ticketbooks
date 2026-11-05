import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/rbac";
import * as svc from "@/lib/testcases/service";
import { canViewTicket } from "@/lib/tickets/service";
import { sha256 } from "@/lib/auth/password";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";

/** Integration tests against the real database, using scratch data removed afterwards. */
const db = new PrismaClient();
const stamp = String(Date.now()).slice(-7);

let projectId = "";
let projectKey = "";
let ticketKey = "";
let ticketId = "";
let writer: SessionUser;
let viewer: SessionUser;
let admin: SessionUser;

const actor = (id: string, permissions: string[]): SessionUser => ({
  id, email: `${id}@t.io`, firstName: "T", lastName: "U", avatarUrl: null, jobTitle: null, timeZone: null, phone: null,
  status: "ACTIVE", teamId: null, teamName: null, managedTeamIds: [], roleId: "r", roleName: "x", permissions, prefs: {},
});
const params = (o: Record<string, string>) => new URLSearchParams({ projectId, ...o });
const steps = [{ action: "Open login", expected: "Form shows" }, { action: "Submit", expected: "Dashboard shows" }];
const newCase = (extra: Partial<Parameters<typeof svc.createCase>[1]> = {}) => svc.createCase(writer, { projectId, title: "User signs in", steps, ...extra });

beforeAll(async () => {
  const role = await db.role.findUniqueOrThrow({ where: { name: "Employee" } });
  const mk = (n: string) => db.user.create({ data: { firstName: "T", lastName: n, email: `tc-${n}-${stamp}@t.io`, passwordHash: "x", roleId: role.id, status: "ACTIVE" } });
  const [w, v, a] = await Promise.all([mk("writer"), mk("viewer"), mk("admin")]);
  writer = actor(w.id, ["testcase.manage", "testcase.execute"]);
  viewer = actor(v.id, []);
  admin = actor(a.id, ["*"]);

  projectKey = `TC${stamp}`;
  const project = await db.project.create({ data: { key: projectKey, name: "Scratch" } });
  projectId = project.id;
  const [status, priority, type] = await Promise.all([db.status.findFirstOrThrow(), db.priority.findFirstOrThrow(), db.ticketType.findFirstOrThrow()]);
  // Reported by admin, so neither writer nor viewer can see it
  ticketKey = `${projectKey}-1`;
  const t = await db.ticket.create({ data: { key: ticketKey, number: 1, projectId, typeId: type.id, statusId: status.id, priorityId: priority.id, title: "Private ticket", reporterId: a.id } });
  ticketId = t.id;
});

afterAll(async () => {
  await db.testCase.deleteMany({ where: { projectId } });
  await db.testPlan.deleteMany({ where: { projectId } });
  await db.ticket.deleteMany({ where: { projectId } });
  await db.project.delete({ where: { id: projectId } });
  const ids = [writer.id, viewer.id, admin.id];
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("permissions", () => {
  it("blocks every write without the permission", async () => {
    const c = await newCase();
    const plan = await svc.createPlan(writer, { projectId, name: "Perm plan" });
    const denied = /permission/;
    await expect(svc.createCase(viewer, { projectId, title: "Nope" })).rejects.toThrow(denied);
    await expect(svc.updateCase(viewer, c.key, { title: "Nope" })).rejects.toThrow(denied);
    await expect(svc.deleteCase(viewer, c.key)).rejects.toThrow(denied);
    await expect(svc.setAutomation(viewer, c.key, { automationStatus: "WONT_AUTOMATE" })).rejects.toThrow(denied);
    await expect(svc.recordResult(viewer, { key: c.key, outcome: "PASS" }, "MANUAL")).rejects.toThrow(denied);
    await expect(svc.recordResults(viewer, [{ key: c.key, outcome: "PASS" }], "MANUAL")).rejects.toThrow(denied);
    await expect(svc.createPlan(viewer, { projectId, name: "Nope" })).rejects.toThrow(denied);
    await expect(svc.deletePlan(viewer, plan.key)).rejects.toThrow(denied);
    await expect(svc.createSuite(viewer, plan.key, { name: "Nope" })).rejects.toThrow(denied);
  });

  it("lets anyone signed in read", async () => {
    const c = await newCase();
    expect((await svc.getCase(viewer, c.key)).testCase.key).toBe(c.key);
    expect((await svc.listCases(viewer, params({}))).total).toBeGreaterThan(0);
  });
});

describe("numbering", () => {
  it("never repeats a key under concurrency", async () => {
    const created = await Promise.all(Array.from({ length: 10 }, () => newCase()));
    const keys = created.map((c) => c.key);
    expect(new Set(keys).size).toBe(10);
    expect(keys[0]).toMatch(new RegExp(`^${projectKey}-TC-\\d+$`));
  });
});

describe("Playwright loop", () => {
  it("only raises the version when title, preconditions or steps change", async () => {
    const c = await newCase();
    expect(c.version).toBe(1);
    expect((await svc.updateCase(writer, c.key, { tags: ["smoke"], status: "READY" })).version).toBe(1);
    expect((await svc.updateCase(writer, c.key, { steps })).version).toBe(1); // same content
    expect((await svc.updateCase(writer, c.key, { steps: [...steps, { action: "Log out", expected: "" }] })).version).toBe(2);
  });

  it("queues ready cases, tracks the automation link and flags drift", async () => {
    const c = await newCase({ status: "READY", tags: ["pw"] });
    const queue = await svc.listCases(writer, params({ status: "READY", automationStatus: "NOT_AUTOMATED", tag: "pw", includeSteps: "true" }));
    const queued = queue.testCases.find((x) => x.key === c.key) as unknown as { steps: unknown[] };
    expect(queued.steps).toHaveLength(2);

    await expect(svc.setAutomation(writer, c.key, { automationStatus: "AUTOMATED", version: 1 })).rejects.toThrow(/automationRef/);
    await expect(svc.setAutomation(writer, c.key, { automationStatus: "AUTOMATED", automationRef: "a.spec.ts" })).rejects.toThrow(/version/);
    await expect(svc.setAutomation(writer, c.key, { automationStatus: "AUTOMATED", automationRef: "a.spec.ts", version: 99 })).rejects.toThrow(/newer/);

    const linked = await svc.setAutomation(writer, c.key, { automationStatus: "AUTOMATED", automationRef: "a.spec.ts > signs in", version: 1 });
    expect(linked.stale).toBe(false);
    const staleKeys = async () => (await svc.listCases(writer, params({ automationStale: "true" }))).testCases.map((x) => x.key);
    expect(await staleKeys()).not.toContain(c.key);

    const edited = await svc.updateCase(writer, c.key, { title: "User signs in with SSO" });
    expect(edited.stale).toBe(true);
    expect(await staleKeys()).toContain(c.key);

    expect((await svc.setAutomation(writer, c.key, { automationStatus: "AUTOMATED", automationRef: "a.spec.ts > signs in", version: 2 })).stale).toBe(false);
  });
});

describe("results", () => {
  it("adds a row and updates the latest result together, with a step snapshot", async () => {
    const c = await newCase();
    await svc.recordResult(writer, { key: c.key, outcome: "FAIL", stepResults: [{ outcome: "PASS" }, { outcome: "FAIL", comment: "500" }], buildVersion: "abc" }, "MANUAL");
    await svc.updateCase(writer, c.key, { steps: [{ action: "Changed", expected: "" }] });
    const { testCase, results } = await svc.getCase(writer, c.key);
    expect(testCase.lastResult).toBe("FAIL");
    expect(testCase.lastRunAt).not.toBeNull();
    expect(results).toHaveLength(1);
    expect((results[0].stepResults as { action: string; comment: string }[])[1]).toMatchObject({ action: "Submit", comment: "500" });
  });

  it("rejects bad step counts, and deprecated or deleted cases", async () => {
    const c = await newCase();
    await expect(svc.recordResult(writer, { key: c.key, outcome: "PASS", stepResults: [] }, "MANUAL")).rejects.toThrow(/one entry/);
    await svc.updateCase(writer, c.key, { status: "DEPRECATED" });
    await expect(svc.recordResult(writer, { key: c.key, outcome: "PASS" }, "MANUAL")).rejects.toThrow(/deprecated/);
    const d = await newCase();
    await svc.deleteCase(writer, d.key);
    await expect(svc.recordResult(writer, { key: d.key, outcome: "PASS" }, "MANUAL")).rejects.toThrow(/not found/);
    await expect(svc.getCase(writer, d.key)).rejects.toThrow(/not found/);
  });

  it("reports bulk failures per entry without losing the rest", async () => {
    const [a, b] = [await newCase(), await newCase()];
    const out = await svc.recordResults(writer, [{ key: a.key, outcome: "PASS" }, { key: `${projectKey}-TC-999999`, outcome: "PASS" }, { key: b.key, outcome: "FAIL" }], "AUTOMATED");
    expect(out.recorded.map((r) => r.key)).toEqual([a.key, b.key]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].error).toMatch(/not found/);
    expect((await svc.getCase(writer, a.key)).results[0].source).toBe("AUTOMATED");
  });

  it("rejects new work on an archived project", async () => {
    const c = await newCase();
    await db.project.update({ where: { id: projectId }, data: { archived: true } });
    try {
      await expect(newCase()).rejects.toThrow(/archived/);
      await expect(svc.recordResult(writer, { key: c.key, outcome: "PASS" }, "MANUAL")).rejects.toThrow(/archived/);
    } finally {
      await db.project.update({ where: { id: projectId }, data: { archived: false } });
    }
  });
});

describe("ticket privacy", () => {
  it("won't link or attach a ticket the actor can't see", async () => {
    await expect(newCase({ ticketKeys: [ticketKey] })).rejects.toThrow(/not found/);
    const c = await newCase();
    await expect(svc.recordResult(writer, { key: c.key, outcome: "FAIL", bugTicketKey: ticketKey }, "MANUAL")).rejects.toThrow(/not found/);
  });

  it("hides linked tickets and bugs from users who can't see them", async () => {
    const c = await svc.createCase(admin, { projectId, title: "Linked case", ticketKeys: [ticketKey] });
    await svc.recordResult(admin, { key: c.key, outcome: "FAIL", bugTicketKey: ticketKey }, "MANUAL");

    const seen = await svc.getCase(admin, c.key);
    expect(seen.testCase.tickets.map((t) => t.key)).toEqual([ticketKey]);
    expect(seen.results[0].bugTicket?.key).toBe(ticketKey);

    const hidden = await svc.getCase(viewer, c.key);
    expect(hidden.testCase.tickets).toEqual([]);
    expect(hidden.results[0].bugTicket).toBeNull();

    await expect(svc.listCases(viewer, params({ ticketKey }))).rejects.toThrow(/access/);
    expect((await svc.listCases(admin, params({ ticketKey }))).testCases.map((x) => x.key)).toEqual([c.key]);
  });

  it("keeps links the editor can't see when they replace the set", async () => {
    const c = await svc.createCase(admin, { projectId, title: "Keeps link", ticketKeys: [ticketKey] });
    await svc.updateCase(writer, c.key, { ticketKeys: [] });
    expect((await svc.getCase(admin, c.key)).testCase.tickets.map((t) => t.key)).toEqual([ticketKey]);
    await svc.updateCase(admin, c.key, { ticketKeys: [] });
    expect((await svc.getCase(admin, c.key)).testCase.tickets).toEqual([]);
  });

  it("canViewTicket: comment access fix", async () => {
    expect(await canViewTicket(viewer, ticketId)).toBe(false);
    expect(await canViewTicket(admin, ticketId)).toBe(true);
    const comment = await db.comment.create({ data: { ticketId, authorId: viewer.id, body: "hi" } });
    expect(await canViewTicket(viewer, ticketId)).toBe(true);
    await db.comment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
    expect(await canViewTicket(viewer, ticketId)).toBe(false); // a deleted comment grants nothing
    await db.comment.delete({ where: { id: comment.id } });
  });

  it("revokes CI tokens when a password is reset", async () => {
    const future = new Date(Date.now() + 3600000);
    const ci = await db.ciToken.create({ data: { name: "t", tokenHash: `ci-${stamp}`, userId: viewer.id, expiresAt: future } });
    await db.passwordResetToken.create({ data: { userId: viewer.id, tokenHash: sha256(`reset-token-${stamp}`), expiresAt: future } });
    const res = await resetPassword(new Request("http://t/api/auth/reset-password", {
      method: "POST", body: JSON.stringify({ token: `reset-token-${stamp}`, newPassword: "a-new-password-1" }),
    }));
    expect((await res.json()).success).toBe(true);
    expect((await db.ciToken.findUniqueOrThrow({ where: { id: ci.id } })).revokedAt).not.toBeNull();
  });
});

describe("test plans", () => {
  const setup = async () => {
    const c = await newCase();
    const plan = await svc.createPlan(writer, { projectId, name: "Release 1" });
    const root = (await svc.getPlan(writer, plan.key)).suites[0];
    return { c, plan, root };
  };

  it("starts with a root suite that can't be moved or deleted", async () => {
    const { plan, root } = await setup();
    expect(plan.key).toMatch(new RegExp(`^${projectKey}-TP-\\d+$`));
    expect(root.parentId).toBeNull();
    const child = await svc.createSuite(writer, plan.key, { name: "Login" });
    expect(child.parentId).toBe(root.id);
    await expect(svc.deleteSuite(writer, root.id)).rejects.toThrow(/root/);
    await expect(svc.updateSuite(writer, root.id, { parentId: child.id })).rejects.toThrow(/root/);
    await expect(svc.updateSuite(writer, child.id, { parentId: child.id })).rejects.toThrow(/itself/);
  });

  it("creates a point per configuration, skips duplicates and rejects bad cases", async () => {
    const { c, root } = await setup();
    expect(await svc.addPoints(writer, root.id, { testCaseKeys: [c.key], configurations: ["Chrome", "Edge"] })).toEqual({ added: 2, skipped: 0 });
    expect(await svc.addPoints(writer, root.id, { testCaseKeys: [c.key], configurations: ["Chrome", "Firefox"] })).toEqual({ added: 1, skipped: 1 });
    await expect(svc.addPoints(writer, root.id, { testCaseKeys: ["NOPE-TC-1"] })).rejects.toThrow(/not found/);
    const dep = await newCase({ status: "DEPRECATED" });
    await expect(svc.addPoints(writer, root.id, { testCaseKeys: [dep.key] })).rejects.toThrow(/Deprecated/);
  });

  it("tracks outcomes per point and counts them on the plan", async () => {
    const { c, plan, root } = await setup();
    await svc.addPoints(writer, root.id, { testCaseKeys: [c.key], configurations: ["Chrome", "Edge"] });
    const { points } = await svc.getPlan(writer, plan.key);
    const chrome = points.find((p) => p.configuration === "Chrome")!;
    await svc.recordResult(writer, { pointId: chrome.id, outcome: "PASS", buildVersion: "b1" }, "MANUAL");
    await expect(svc.recordResult(writer, { pointId: chrome.id, key: "OTHER-TC-1", outcome: "PASS" }, "MANUAL")).rejects.toThrow(/belongs to/);

    const after = await svc.getPlan(writer, plan.key);
    expect(after.testPlan.counts).toMatchObject({ PASS: 1, NOT_RUN: 1, total: 2 });
    expect(after.points.find((p) => p.id === chrome.id)!.lastBuild).toBe("b1");
    expect(after.points.find((p) => p.configuration === "Edge")!.lastResult).toBeNull();
    expect((await svc.getCase(writer, c.key)).testCase.lastResult).toBe("PASS");

    const listed = await svc.listPlans(writer, params({}));
    expect(listed.testPlans.find((p) => p.key === plan.key)!.counts.PASS).toBe(1);
  });

  it("makes a completed plan read-only until it is reopened", async () => {
    const { c, plan, root } = await setup();
    await svc.addPoints(writer, root.id, { testCaseKeys: [c.key] });
    const point = (await svc.getPlan(writer, plan.key)).points[0];
    await svc.updatePlan(writer, plan.key, { status: "COMPLETED" });
    await expect(svc.recordResult(writer, { pointId: point.id, outcome: "PASS" }, "MANUAL")).rejects.toThrow(/completed/);
    await expect(svc.createSuite(writer, plan.key, { name: "Nope" })).rejects.toThrow(/completed/);
    await expect(svc.addPoints(writer, root.id, { testCaseKeys: [c.key], configurations: ["X"] })).rejects.toThrow(/completed/);
    await expect(svc.updatePoint(writer, point.id, { testerId: writer.id })).rejects.toThrow(/completed/);
    await expect(svc.deletePoint(writer, point.id)).rejects.toThrow(/completed/);
    await svc.updatePlan(writer, plan.key, { status: "ACTIVE" });
    await svc.recordResult(writer, { pointId: point.id, outcome: "PASS" }, "MANUAL");
  });

  it("keeps result history when suites, points and plans are removed", async () => {
    const { c, plan, root } = await setup();
    const suite = await svc.createSuite(writer, plan.key, { name: "Removed" });
    await svc.addPoints(writer, suite.id, { testCaseKeys: [c.key] });
    await svc.addPoints(writer, root.id, { testCaseKeys: [c.key] });
    const points = (await svc.getPlan(writer, plan.key)).points;
    for (const p of points) await svc.recordResult(writer, { pointId: p.id, outcome: "PASS" }, "MANUAL");

    await svc.deleteSuite(writer, suite.id);
    const rootPoint = (await svc.getPlan(writer, plan.key)).points[0];
    await svc.deletePoint(writer, rootPoint.id);
    await svc.deletePlan(writer, plan.key);

    const { results, testCase } = await svc.getCase(writer, c.key);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.pointId === null)).toBe(true);
    expect(testCase.plans).toEqual([]);
    await expect(svc.getPlan(writer, plan.key)).rejects.toThrow(/not found/);
    await expect(svc.createSuite(writer, plan.key, { name: "Nope" })).rejects.toThrow(/not found/);
  });

  it("only allows a sprint from the same project", async () => {
    const other = await db.project.create({ data: { key: `TX${stamp}`, name: "Other", sprints: { create: { name: "S1" } } }, include: { sprints: true } });
    try {
      await expect(svc.createPlan(writer, { projectId, name: "Bad sprint", sprintId: other.sprints[0].id })).rejects.toThrow(/Sprint/);
    } finally {
      await db.project.delete({ where: { id: other.id } });
    }
  });
});

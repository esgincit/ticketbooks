import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/rbac";
import * as svc from "@/lib/testcases/service";
import { addComment, canViewTicket, claimTicket, setWatching } from "@/lib/tickets/service";
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

  it("won't let a user give themselves access to a hidden ticket", async () => {
    const commenter = { ...viewer, permissions: ["ticket.comment", "ticket.claim"] };
    await expect(addComment(commenter, ticketKey, "let me in")).rejects.toThrow(/access/);
    await expect(setWatching(commenter, ticketKey, true)).rejects.toThrow(/access/);
    await expect(claimTicket(commenter, ticketKey)).rejects.toThrow(/access/);
    expect(await canViewTicket(commenter, ticketId)).toBe(false);
    expect(await db.comment.count({ where: { ticketId } })).toBe(0);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).assigneeId).toBeNull();

    // Those who can see it still can, and anyone can stop watching
    await expect(setWatching(commenter, ticketKey, false)).resolves.toBeTruthy();
    const comment = await addComment(admin, ticketKey, "fine");
    await db.comment.delete({ where: { id: comment.id } });
  });

  it("signs a user out everywhere when a password is reset", async () => {
    const future = new Date(Date.now() + 3600000);
    const ci = await db.ciToken.create({ data: { name: "t", tokenHash: `ci-${stamp}`, userId: viewer.id, expiresAt: future } });
    const client = await db.mcpClient.create({ data: { name: `tc-${stamp}`, redirectUris: [] } });
    const mcp = await db.mcpToken.create({ data: { tokenHash: `mcp-${stamp}`, kind: "refresh", userId: viewer.id, clientId: client.id, expiresAt: future } });
    await db.session.create({ data: { tokenHash: `sess-${stamp}`, userId: viewer.id, expiresAt: future } });
    await db.passwordResetToken.create({ data: { userId: viewer.id, tokenHash: sha256(`reset-token-${stamp}`), expiresAt: future } });
    const res = await resetPassword(new Request("http://t/api/auth/reset-password", {
      method: "POST", body: JSON.stringify({ token: `reset-token-${stamp}`, newPassword: "a-new-password-1" }),
    }));
    expect((await res.json()).success).toBe(true);
    expect((await db.ciToken.findUniqueOrThrow({ where: { id: ci.id } })).revokedAt).not.toBeNull();
    expect((await db.mcpToken.findUniqueOrThrow({ where: { id: mcp.id } })).revokedAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: viewer.id } })).toBe(0);
    await db.mcpClient.delete({ where: { id: client.id } });
    expect(await db.passwordResetToken.count({ where: { userId: viewer.id } })).toBe(0);
  });

  it("cancels unused emailed reset codes when a user is signed out everywhere", async () => {
    const real = await db.user.findUniqueOrThrow({ where: { id: viewer.id } });
    const otp = await db.otpToken.create({ data: { email: real.email, otpHash: "x", purpose: "password_reset", expiresAt: new Date(Date.now() + 600000) } });
    const raw = `otp-reset-${stamp}`;
    await db.passwordResetToken.create({ data: { userId: viewer.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3600000) } });
    const res = await resetPassword(new Request("http://t/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token: raw, newPassword: "a-new-password-3" }) }));
    expect((await res.json()).success).toBe(true);
    expect((await db.otpToken.findUniqueOrThrow({ where: { id: otp.id } })).expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    await db.otpToken.delete({ where: { id: otp.id } });
  });

  it("won't let a reset link re-enable a disabled account", async () => {
    const raw = `disabled-token-${stamp}`;
    await db.user.update({ where: { id: viewer.id }, data: { status: "DISABLED" } });
    await db.passwordResetToken.create({ data: { userId: viewer.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3600000) } });
    const res = await resetPassword(new Request("http://t/api/auth/reset-password", {
      method: "POST", body: JSON.stringify({ token: raw, newPassword: "a-new-password-2" }),
    }));
    expect((await res.json()).success).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: viewer.id } })).status).toBe("DISABLED");
    await db.passwordResetToken.deleteMany({ where: { userId: viewer.id } });
    await db.user.update({ where: { id: viewer.id }, data: { status: "ACTIVE" } });
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

describe("history", () => {
  const editor = () => ({ ...viewer, permissions: ["testcase.manage"] });

  it("lets someone else edit a case, and records who changed what", async () => {
    const c = await newCase({ title: "Sign in works", tags: ["smoke"] });
    await svc.updateCase(editor(), c.key, {
      title: "Sign in still works", tags: ["smoke", "login"], status: "READY",
      steps: [steps[0], { action: "Press submit", expected: "Dashboard shows" }, { action: "Sign out", expected: "" }],
    });
    const { history } = await svc.caseHistory(writer, c.key);
    expect(history.map((h) => [h.action, h.user?.id])).toEqual([["TEST_CASE_UPDATED", viewer.id], ["TEST_CASE_CREATED", writer.id]]);
    expect(history[0].version).toBe(2);
    expect(history[0].changes).toEqual([
      { field: "Title", from: "Sign in works", to: "Sign in still works" },
      { field: "Step 2", from: "Submit\nExpected: Dashboard shows", to: "Press submit\nExpected: Dashboard shows" },
      { field: "Step 3", from: null, to: "Sign out" },
      { field: "Tags", from: "smoke", to: "smoke, login" },
      { field: "Status", from: "Draft", to: "Ready" },
    ]);
  });

  it("names the owner and priority rather than their IDs", async () => {
    const c = await newCase();
    const other = await db.priority.findFirstOrThrow({ where: { id: { not: c.priorityId } } });
    await svc.updateCase(editor(), c.key, { ownerId: viewer.id, priorityId: other.id });
    const [latest] = (await svc.caseHistory(writer, c.key)).history;
    expect(latest.changes.find((x) => x.field === "Priority")?.to).toBe(other.name);
    expect(latest.changes.find((x) => x.field === "Owner")).toEqual({ field: "Owner", from: "T writer", to: "T viewer" });
  });

  it("adds nothing when a save changes nothing", async () => {
    const c = await newCase();
    await svc.updateCase(editor(), c.key, { title: c.title, steps, status: c.status as "DRAFT", tags: [] });
    expect((await svc.caseHistory(writer, c.key)).history.map((h) => h.action)).toEqual(["TEST_CASE_CREATED"]);
  });

  it("shows a linked ticket's key only to people who can see that ticket", async () => {
    const c = await newCase();
    await svc.updateCase(admin, c.key, { ticketKeys: [ticketKey] });
    const shown = async (who: SessionUser) => (await svc.caseHistory(who, c.key)).history[0].changes;
    expect(await shown(admin)).toEqual([{ field: "Linked ticket", from: null, to: ticketKey }]);
    expect(await shown(writer)).toEqual([]);
  });

  it("does not expose the IP or browser recorded in the audit log", async () => {
    const c = await newCase();
    const entry = (await svc.caseHistory(viewer, c.key)).history[0];
    expect(entry).not.toHaveProperty("ip");
    expect(entry).not.toHaveProperty("userAgent");
  });

  it("records suite changes under the plan, including the root suite and deleted suites", async () => {
    const plan = await svc.createPlan(writer, { projectId, name: "History plan" });
    const root = (await svc.getPlan(writer, plan.key)).suites[0];
    await svc.updateSuite(editor(), root.id, { name: "Renamed root" });

    const suite = await svc.createSuite(writer, plan.key, { name: "Checkout" });
    await svc.updateSuite(editor(), suite.id, { name: "Payment" });
    const c = await newCase();
    await svc.addPoints(editor(), suite.id, { testCaseKeys: [c.key], configurations: ["Chrome"] });
    await svc.addPoints(editor(), suite.id, { testCaseKeys: [c.key], configurations: ["Chrome"] }); // duplicate: nothing happened
    const { points } = await svc.getPlan(writer, plan.key);
    await svc.updatePoint(editor(), points[0].id, { testerId: writer.id });
    await svc.deletePoint(editor(), points[0].id);
    await svc.deleteSuite(writer, suite.id);

    const { history } = await svc.planHistory(viewer, plan.key);
    const of = (action: string) => history.filter((h) => h.action === action);
    expect(of("TEST_SUITE_UPDATED").map((h) => h.changes)).toEqual([
      [{ field: "Name", from: "Checkout", to: "Payment" }],
      [{ field: "Name", from: "History plan", to: "Renamed root" }],
    ]);
    expect(of("TEST_SUITE_UPDATED")[0].user?.id).toBe(viewer.id);
    expect(of("TEST_POINTS_ADDED")).toHaveLength(1);
    expect(of("TEST_POINTS_ADDED")[0].changes).toEqual([{ field: "Test cases added", from: null, to: `${c.key} (Chrome)` }]);
    expect(of("TEST_POINT_ASSIGNED")[0].changes).toEqual([{ field: `Tester of ${c.key} (Chrome)`, from: null, to: "T writer" }]);
    expect(of("TEST_POINT_REMOVED")[0].changes).toEqual([{ field: "Test case removed", from: `${c.key} (Chrome)`, to: null }]);
    expect(of("TEST_SUITE_DELETED")[0].suiteId).toBe(suite.id);
    expect(history.filter((h) => h.suiteId === suite.id)).toHaveLength(6);
    // Another plan's history stays separate
    const other = await svc.createPlan(writer, { projectId, name: "Other plan" });
    expect((await svc.planHistory(viewer, other.key)).history.map((h) => h.action)).toEqual(["TEST_PLAN_CREATED"]);
  });

  it("still refuses people whose role has no test permission", async () => {
    const c = await newCase();
    await expect(svc.updateCase(viewer, c.key, { title: "Nope nope" })).rejects.toThrow();
  });
});

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/history";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { can, ticketScopeFor } from "@/lib/rbac";
import { canViewTicket } from "@/lib/tickets/service";
import type { SessionUser } from "@/lib/auth/session";
import {
  AUTOMATION_STATUSES, CASE_STATUSES, OUTCOMES, PLAN_STATUSES,
  buildStepResults, contentChanged, countOutcomes, isStale, suitePlacementError,
  type Step,
} from "./rules";

// --- Input schemas --------------------------------------------------------------

const stepSchema = z.object({
  action: z.string().trim().min(1).max(5000),
  expected: z.string().trim().max(5000).default(""),
  data: z.string().trim().max(5000).optional(),
});
const caseFields = {
  title: z.string().trim().min(3).max(300),
  preconditions: z.string().max(5000),
  steps: z.array(stepSchema).max(100),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
  priorityId: z.string(),
  status: z.enum(CASE_STATUSES),
  ownerId: z.string().nullable(),
  ticketKeys: z.array(z.string()).max(100),
};
export const createCaseSchema = z.object({
  projectId: z.string(),
  title: caseFields.title,
  preconditions: caseFields.preconditions.optional(),
  steps: caseFields.steps.optional(),
  tags: caseFields.tags.optional(),
  priorityId: caseFields.priorityId.optional(),
  status: caseFields.status.optional(),
  ownerId: caseFields.ownerId.optional(),
  ticketKeys: caseFields.ticketKeys.optional(),
});
export const updateCaseSchema = z.object(caseFields).partial();
export const automationSchema = z.object({
  automationStatus: z.enum(AUTOMATION_STATUSES),
  automationRef: z.string().trim().min(1).max(500).optional(),
  version: z.number().int().min(1).optional(),
});
const resultFields = {
  key: z.string().optional(),
  pointId: z.string().optional(),
  outcome: z.enum(OUTCOMES),
  source: z.enum(["MANUAL", "AUTOMATED"]).optional(),
  stepResults: z.array(z.object({ outcome: z.enum(OUTCOMES), comment: z.string().max(5000).optional() })).max(100).optional(),
  notes: z.string().max(5000).optional(),
  buildVersion: z.string().trim().max(100).optional(),
  bugTicketKey: z.string().optional(),
};
export const resultSchema = z.object(resultFields);
export type ResultInput = z.infer<typeof resultSchema>;
export const resultsBodySchema = z.union([
  z.object({ results: z.array(resultSchema).min(1).max(200) }),
  resultSchema,
]);

const dateField = z.string().datetime({ offset: true }).nullable();
export const createPlanSchema = z.object({
  projectId: z.string(),
  name: z.string().trim().min(2).max(120),
  description: z.string().max(5000).optional(),
  sprintId: z.string().nullable().optional(),
  startDate: dateField.optional(),
  endDate: dateField.optional(),
  ownerId: z.string().nullable().optional(),
});
export const updatePlanSchema = createPlanSchema.omit({ projectId: true }).partial().extend({ status: z.enum(PLAN_STATUSES).optional() });
export const createSuiteSchema = z.object({ name: z.string().trim().min(2).max(120), parentId: z.string().optional() });
export const updateSuiteSchema = z.object({ name: createSuiteSchema.shape.name.optional(), parentId: z.string().optional(), order: z.number().int().min(0).optional() });
export const addPointsSchema = z.object({
  testCaseKeys: z.array(z.string()).min(1).max(500),
  configurations: z.array(z.string().trim().max(80)).max(10).optional(),
  testerId: z.string().nullable().optional(),
});
export const updatePointSchema = z.object({ testerId: z.string().nullable() });

// --- Helpers ----------------------------------------------------------------------

const userRef = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } as const;
const MANAGE = "testcase.manage";
const EXECUTE = "testcase.execute";

function require_(actor: SessionUser, permission: string) {
  if (!can(actor, permission)) throw forbidden();
}

export function testPermissions(actor: SessionUser) {
  return { canManage: can(actor, MANAGE), canExecute: can(actor, EXECUTE), canCreateTicket: can(actor, "ticket.create") };
}

const pageOf = (params: URLSearchParams, maxSize = 200) => {
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number(params.get("pageSize")) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

async function openProject(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Project not found");
  if (project.archived) throw badRequest("This project is archived");
  return project;
}

async function nextNumber(projectId: string, column: "nextCase" | "nextPlan"): Promise<number> {
  // Atomic: concurrent creates can never get the same number
  const sql = column === "nextCase"
    ? Prisma.sql`INSERT INTO "TestCounter" ("projectId", "nextCase", "nextPlan") VALUES (${projectId}, 1, 0)
        ON CONFLICT ("projectId") DO UPDATE SET "nextCase" = "TestCounter"."nextCase" + 1 RETURNING "nextCase" AS num`
    : Prisma.sql`INSERT INTO "TestCounter" ("projectId", "nextCase", "nextPlan") VALUES (${projectId}, 0, 1)
        ON CONFLICT ("projectId") DO UPDATE SET "nextPlan" = "TestCounter"."nextPlan" + 1 RETURNING "nextPlan" AS num`;
  const rows = await db.$queryRaw<{ num: number }[]>(sql);
  return Number(rows[0].num);
}

async function assertActiveUser(id: string | null | undefined) {
  if (!id) return;
  const user = await db.user.findFirst({ where: { id, status: { not: "DISABLED" } }, select: { id: true } });
  if (!user) throw badRequest("User not found or disabled");
}

async function assertPriority(id: string) {
  if (!(await db.priority.findUnique({ where: { id }, select: { id: true } }))) throw badRequest("Priority not found");
}

/** Tickets must be in this project and visible to the actor; a key they can't see looks the same as a missing one */
async function resolveTickets(actor: SessionUser, projectId: string, keys: string[]) {
  const wanted = [...new Set(keys.map((k) => k.trim().toUpperCase()))];
  if (wanted.length === 0) return [];
  const found = await db.ticket.findMany({
    where: { AND: [{ key: { in: wanted }, projectId, deletedAt: null }, ticketScopeFor(actor)] },
    select: { id: true, key: true },
  });
  const missing = wanted.filter((k) => !found.some((t) => t.key === k));
  if (missing.length) throw badRequest(`Tickets not found in this project: ${missing.join(", ")}`);
  return found;
}

const asSteps = (v: Prisma.JsonValue) => (Array.isArray(v) ? (v as unknown as Step[]) : []);
const withStale = <T extends { automationStatus: string; version: number; automatedVersion: number | null }>(c: T) => ({ ...c, stale: isStale(c) });

async function getCaseOr404(key: string) {
  const c = await db.testCase.findFirst({ where: { key: key.toUpperCase(), deletedAt: null } });
  if (!c) throw notFound("Test case not found");
  return c;
}

// --- Test cases -------------------------------------------------------------------

export async function listCases(actor: SessionUser, params: URLSearchParams) {
  const includeSteps = params.get("includeSteps") === "true";
  const { page, pageSize, skip, take } = pageOf(params, includeSteps ? 50 : 200);
  const where: Prisma.TestCaseWhereInput = { deletedAt: null, project: { archived: false } };
  const and: Prisma.TestCaseWhereInput[] = [];

  const projectId = params.get("projectId");
  if (projectId) where.projectId = projectId;
  const status = params.get("status");
  if (status) where.status = status;
  const automationStatus = params.get("automationStatus");
  if (automationStatus) where.automationStatus = automationStatus;
  if (params.get("automationStale") === "true") {
    where.automationStatus = "AUTOMATED";
    where.version = { gt: db.testCase.fields.automatedVersion };
  }
  const lastResult = params.get("lastResult");
  if (lastResult) where.lastResult = lastResult === "NOT_RUN" ? null : lastResult;
  const tag = params.get("tag");
  if (tag) where.tags = { array_contains: [tag] };
  const q = params.get("q")?.trim();
  if (q) and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { key: { contains: q, mode: "insensitive" } }] });
  const ticketKey = params.get("ticketKey");
  if (ticketKey) {
    const ticket = await db.ticket.findFirst({ where: { key: ticketKey.toUpperCase(), deletedAt: null }, select: { id: true } });
    if (!ticket) throw notFound("Ticket not found");
    if (!(await canViewTicket(actor, ticket.id))) throw forbidden("You do not have access to this ticket");
    where.tickets = { some: { ticketId: ticket.id } };
  }
  if (and.length) where.AND = and;

  const [rows, total] = await Promise.all([
    db.testCase.findMany({
      where, skip, take, orderBy: { number: "desc" },
      include: { project: { select: { id: true, key: true, name: true } }, priority: { select: { id: true, name: true, color: true } }, owner: userRef },
    }),
    db.testCase.count({ where }),
  ]);
  const testCases = rows.map((row) => {
    const c = withStale(row);
    if (includeSteps) return c;
    const { steps: _omit, ...rest } = c;
    return rest;
  });
  return { testCases, total, page, pageSize, permissions: testPermissions(actor) };
}

export async function getCase(actor: SessionUser, key: string) {
  const row = await db.testCase.findFirst({
    where: { key: key.toUpperCase(), deletedAt: null },
    include: {
      project: { select: { id: true, key: true, name: true } },
      priority: { select: { id: true, name: true, color: true } },
      owner: userRef,
    },
  });
  if (!row) throw notFound("Test case not found");

  const [tickets, results, points] = await Promise.all([
    db.ticket.findMany({
      where: { AND: [{ deletedAt: null, testCaseLinks: { some: { testCaseId: row.id } } }, ticketScopeFor(actor)] },
      select: { id: true, key: true, title: true, status: { select: { name: true, color: true, category: true } } },
      orderBy: { key: "asc" },
    }),
    db.testResult.findMany({
      where: { testCaseId: row.id },
      include: { executedBy: userRef, bugTicket: { select: { id: true, key: true, title: true } }, point: { select: { configuration: true, suite: { select: { name: true, plan: { select: { key: true, name: true } } } } } } },
      orderBy: { executedAt: "desc" },
      take: 50,
    }),
    db.testPoint.findMany({
      where: { testCaseId: row.id, suite: { plan: { deletedAt: null } } },
      select: { suite: { select: { name: true, plan: { select: { key: true, name: true, status: true } } } } },
    }),
  ]);

  // Hide bug tickets this user can't see: test results are visible more widely than tickets
  const bugIds = results.flatMap((r) => (r.bugTicketId ? [r.bugTicketId] : []));
  const visibleBugs = bugIds.length
    ? new Set((await db.ticket.findMany({ where: { AND: [{ id: { in: bugIds } }, ticketScopeFor(actor)] }, select: { id: true } })).map((t) => t.id))
    : new Set<string>();
  const plans = [...new Map(points.map((p) => [p.suite.plan.key, p.suite.plan])).values()];

  return {
    testCase: { ...withStale(row), tickets, plans },
    results: results.map((r) => ({ ...r, bugTicket: r.bugTicketId && visibleBugs.has(r.bugTicketId) ? r.bugTicket : null, bugTicketId: undefined })),
    permissions: testPermissions(actor),
  };
}

export async function createCase(actor: SessionUser, input: z.infer<typeof createCaseSchema>) {
  require_(actor, MANAGE);
  const project = await openProject(input.projectId);
  const priorityId = input.priorityId ?? (await db.priority.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id;
  if (!priorityId) throw badRequest("priorityId is required");
  await assertPriority(priorityId);
  const ownerId = input.ownerId === undefined ? actor.id : input.ownerId;
  await assertActiveUser(ownerId);
  const tickets = await resolveTickets(actor, project.id, input.ticketKeys ?? []);

  const number = await nextNumber(project.id, "nextCase");
  const created = await db.testCase.create({
    data: {
      key: `${project.key}-TC-${number}`, number, projectId: project.id, title: input.title,
      preconditions: input.preconditions ?? "", steps: input.steps ?? [], tags: [...new Set(input.tags ?? [])],
      priorityId, status: input.status ?? "DRAFT", ownerId,
      tickets: { create: tickets.map((t) => ({ ticketId: t.id })) },
    },
  });
  await audit({ userId: actor.id, action: "TEST_CASE_CREATED", entityType: "TestCase", entityId: created.id, metadata: { key: created.key } });
  return withStale(created);
}

export async function updateCase(actor: SessionUser, key: string, patch: z.infer<typeof updateCaseSchema>) {
  require_(actor, MANAGE);
  const before = await getCaseOr404(key);
  await openProject(before.projectId);
  if (patch.priorityId) await assertPriority(patch.priorityId);
  await assertActiveUser(patch.ownerId);
  const tickets = patch.ticketKeys ? await resolveTickets(actor, before.projectId, patch.ticketKeys) : null;

  const beforeContent = { title: before.title, preconditions: before.preconditions, steps: asSteps(before.steps) };
  const afterContent = {
    title: patch.title ?? before.title,
    preconditions: patch.preconditions ?? before.preconditions,
    steps: (patch.steps as Step[] | undefined) ?? asSteps(before.steps),
  };

  const { ticketKeys: _keys, tags, ...fields } = patch;
  const updated = await db.$transaction(async (tx) => {
    if (tickets) {
      // Links to tickets the actor can't see are kept: they can't remove what they can't see
      const visible = await tx.ticket.findMany({ where: { AND: [{ testCaseLinks: { some: { testCaseId: before.id } } }, ticketScopeFor(actor)] }, select: { id: true } });
      await tx.testCaseTicket.deleteMany({ where: { testCaseId: before.id, ticketId: { in: visible.map((t) => t.id) } } });
      await tx.testCaseTicket.createMany({ data: tickets.map((t) => ({ testCaseId: before.id, ticketId: t.id })), skipDuplicates: true });
    }
    return tx.testCase.update({
      where: { id: before.id },
      data: {
        ...fields,
        ...(tags ? { tags: [...new Set(tags)] } : {}),
        ...(contentChanged(beforeContent, afterContent) ? { version: { increment: 1 } } : {}),
      },
    });
  });
  await audit({ userId: actor.id, action: "TEST_CASE_UPDATED", entityType: "TestCase", entityId: before.id, metadata: { key: before.key, version: updated.version } });
  return withStale(updated);
}

export async function deleteCase(actor: SessionUser, key: string) {
  require_(actor, MANAGE);
  const c = await getCaseOr404(key);
  await db.testCase.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
  await audit({ userId: actor.id, action: "TEST_CASE_DELETED", entityType: "TestCase", entityId: c.id, metadata: { key: c.key } });
}

export async function setAutomation(actor: SessionUser, key: string, input: z.infer<typeof automationSchema>) {
  require_(actor, EXECUTE);
  const c = await getCaseOr404(key);
  await openProject(c.projectId);
  let data: Prisma.TestCaseUpdateInput;
  if (input.automationStatus === "AUTOMATED") {
    if (!input.automationRef) throw badRequest("automationRef is required when marking a case as automated");
    if (input.version === undefined) throw badRequest("version is required: send the case version the test was written from");
    if (input.version > c.version) throw badRequest(`version ${input.version} is newer than the current version ${c.version}`);
    data = { automationStatus: "AUTOMATED", automationRef: input.automationRef, automatedVersion: input.version };
  } else {
    data = { automationStatus: input.automationStatus, automationRef: null, automatedVersion: null };
  }
  const updated = await db.testCase.update({ where: { id: c.id }, data });
  await audit({ userId: actor.id, action: "TEST_CASE_AUTOMATION_SET", entityType: "TestCase", entityId: c.id, metadata: { key: c.key, status: input.automationStatus, ref: input.automationRef ?? null, version: input.version ?? null } });
  return withStale(updated);
}

// --- Results ------------------------------------------------------------------------

export async function recordResult(actor: SessionUser, input: ResultInput, defaultSource: "MANUAL" | "AUTOMATED") {
  require_(actor, EXECUTE);
  if (!input.key && !input.pointId) throw badRequest("Send a test case key or a pointId");

  let testCaseId: string | undefined;
  if (input.pointId) {
    const point = await db.testPoint.findUnique({ where: { id: input.pointId }, include: { suite: { include: { plan: true } } } });
    if (!point || point.suite.plan.deletedAt) throw notFound("Test point not found");
    if (point.suite.plan.status !== "ACTIVE") throw conflict("This test plan is completed. Reopen it to record results.");
    testCaseId = point.testCaseId;
  }
  const c = testCaseId
    ? await db.testCase.findFirst({ where: { id: testCaseId, deletedAt: null } })
    : await db.testCase.findFirst({ where: { key: input.key!.toUpperCase(), deletedAt: null } });
  if (!c) throw notFound("Test case not found");
  if (input.key && input.key.toUpperCase() !== c.key) throw badRequest(`Test point belongs to ${c.key}, not ${input.key}`);
  if (c.status === "DEPRECATED") throw conflict(`${c.key} is deprecated and cannot take new results`);
  await openProject(c.projectId);

  const stepResults = input.stepResults ? buildStepResults(asSteps(c.steps), input.stepResults) : null;
  if (input.stepResults && !stepResults) throw badRequest(`stepResults must have one entry for each of the ${asSteps(c.steps).length} steps`);
  const bug = input.bugTicketKey ? (await resolveTickets(actor, c.projectId, [input.bugTicketKey]))[0] : null;

  const executedAt = new Date();
  const summary = { lastResult: input.outcome, lastRunAt: executedAt };
  const result = await db.$transaction(async (tx) => {
    const created = await tx.testResult.create({
      data: {
        testCaseId: c.id, pointId: input.pointId ?? null, outcome: input.outcome, source: input.source ?? defaultSource,
        stepResults: (stepResults as unknown as Prisma.InputJsonValue) ?? undefined,
        notes: input.notes ?? "", buildVersion: input.buildVersion || null, executedById: actor.id, executedAt, bugTicketId: bug?.id ?? null,
      },
    });
    await tx.testCase.update({ where: { id: c.id }, data: summary });
    if (input.pointId) await tx.testPoint.update({ where: { id: input.pointId }, data: summary });
    return created;
  });
  return { ...result, key: c.key };
}

/** One bad entry must not lose the rest of a test run, so failures are reported per entry */
export async function recordResults(actor: SessionUser, inputs: ResultInput[], defaultSource: "MANUAL" | "AUTOMATED") {
  require_(actor, EXECUTE);
  const recorded: { key: string; id: string; outcome: string }[] = [];
  const failed: { key?: string; pointId?: string; error: string }[] = [];
  for (const input of inputs) {
    try {
      const r = await recordResult(actor, input, defaultSource);
      recorded.push({ key: r.key, id: r.id, outcome: r.outcome });
    } catch (e) {
      failed.push({ key: input.key, pointId: input.pointId, error: e instanceof Error && "status" in e ? e.message : "Could not record this result" });
      if (!(e instanceof Error && "status" in e)) console.error("[test-results]", e);
    }
  }
  await audit({ userId: actor.id, action: "TEST_RESULTS_RECORDED", entityType: "TestResult", metadata: { recorded: recorded.length, failed: failed.length } });
  return { recorded, failed };
}

// --- Test plans -----------------------------------------------------------------------

const dateOf = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);

async function assertSprint(projectId: string, sprintId: string | null | undefined) {
  if (!sprintId) return;
  if (!(await db.sprint.findFirst({ where: { id: sprintId, projectId }, select: { id: true } }))) throw badRequest("Sprint not found in this project");
}

async function getPlanOr404(key: string) {
  const plan = await db.testPlan.findFirst({ where: { key: key.toUpperCase(), deletedAt: null } });
  if (!plan) throw notFound("Test plan not found");
  return plan;
}

function assertPlanOpen(plan: { status: string }) {
  if (plan.status !== "ACTIVE") throw conflict("This test plan is completed. Reopen it to make changes.");
}

export async function listPlans(actor: SessionUser, params: URLSearchParams) {
  const { page, pageSize, skip, take } = pageOf(params);
  const where: Prisma.TestPlanWhereInput = { deletedAt: null, project: { archived: false } };
  const projectId = params.get("projectId");
  if (projectId) where.projectId = projectId;
  const status = params.get("status");
  if (status) where.status = status;
  const q = params.get("q")?.trim();
  if (q) where.name = { contains: q, mode: "insensitive" };

  const [rows, total] = await Promise.all([
    db.testPlan.findMany({
      where, skip, take, orderBy: { number: "desc" },
      include: { project: { select: { id: true, key: true, name: true } }, sprint: { select: { id: true, name: true } }, owner: userRef },
    }),
    db.testPlan.count({ where }),
  ]);
  const points = rows.length
    ? await db.testPoint.findMany({
        where: { suite: { planId: { in: rows.map((r) => r.id) } }, testCase: { deletedAt: null } },
        select: { lastResult: true, suite: { select: { planId: true } } },
      })
    : [];
  return {
    testPlans: rows.map((r) => ({ ...r, counts: countOutcomes(points.filter((p) => p.suite.planId === r.id)) })),
    total, page, pageSize, permissions: testPermissions(actor),
  };
}

export async function getPlan(actor: SessionUser, key: string) {
  const row = await db.testPlan.findFirst({
    where: { key: key.toUpperCase(), deletedAt: null },
    include: { project: { select: { id: true, key: true, name: true } }, sprint: { select: { id: true, name: true } }, owner: userRef },
  });
  if (!row) throw notFound("Test plan not found");
  const [suites, rawPoints] = await Promise.all([
    db.testSuite.findMany({ where: { planId: row.id }, select: { id: true, parentId: true, name: true, order: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    db.testPoint.findMany({
      where: { suite: { planId: row.id }, testCase: { deletedAt: null } },
      include: {
        tester: userRef,
        testCase: { select: { key: true, title: true, status: true, steps: true, version: true, automationStatus: true, automatedVersion: true, automationRef: true, priority: { select: { id: true, name: true, color: true } } } },
        results: { select: { buildVersion: true }, orderBy: { executedAt: "desc" }, take: 1 },
      },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }),
  ]);
  const points = rawPoints.map(({ results, testCase, ...p }) => ({ ...p, testCase: withStale(testCase), lastBuild: results[0]?.buildVersion ?? null }));
  return { testPlan: { ...row, counts: countOutcomes(points) }, suites, points, permissions: testPermissions(actor) };
}

export async function createPlan(actor: SessionUser, input: z.infer<typeof createPlanSchema>) {
  require_(actor, MANAGE);
  const project = await openProject(input.projectId);
  await assertSprint(project.id, input.sprintId);
  const ownerId = input.ownerId === undefined ? actor.id : input.ownerId;
  await assertActiveUser(ownerId);
  const number = await nextNumber(project.id, "nextPlan");
  const plan = await db.testPlan.create({
    data: {
      key: `${project.key}-TP-${number}`, number, projectId: project.id, name: input.name, description: input.description ?? "",
      sprintId: input.sprintId ?? null, startDate: dateOf(input.startDate) ?? null, endDate: dateOf(input.endDate) ?? null, ownerId,
      suites: { create: { name: input.name } }, // root suite
    },
  });
  await audit({ userId: actor.id, action: "TEST_PLAN_CREATED", entityType: "TestPlan", entityId: plan.id, metadata: { key: plan.key } });
  return plan;
}

export async function updatePlan(actor: SessionUser, key: string, patch: z.infer<typeof updatePlanSchema>) {
  require_(actor, MANAGE);
  const plan = await getPlanOr404(key);
  await assertSprint(plan.projectId, patch.sprintId);
  await assertActiveUser(patch.ownerId);
  const updated = await db.testPlan.update({
    where: { id: plan.id },
    data: { ...patch, startDate: dateOf(patch.startDate), endDate: dateOf(patch.endDate) },
  });
  await audit({ userId: actor.id, action: "TEST_PLAN_UPDATED", entityType: "TestPlan", entityId: plan.id, metadata: { key: plan.key, status: updated.status } });
  return updated;
}

export async function deletePlan(actor: SessionUser, key: string) {
  require_(actor, MANAGE);
  const plan = await getPlanOr404(key);
  await db.testPlan.update({ where: { id: plan.id }, data: { deletedAt: new Date() } });
  await audit({ userId: actor.id, action: "TEST_PLAN_DELETED", entityType: "TestPlan", entityId: plan.id, metadata: { key: plan.key } });
}

// --- Suites -----------------------------------------------------------------------------

async function getSuiteOr404(id: string) {
  const suite = await db.testSuite.findUnique({ where: { id }, include: { plan: true } });
  if (!suite || suite.plan.deletedAt) throw notFound("Test suite not found");
  return suite;
}

const planSuites = (planId: string) => db.testSuite.findMany({ where: { planId }, select: { id: true, parentId: true } });

export async function createSuite(actor: SessionUser, planKey: string, input: z.infer<typeof createSuiteSchema>) {
  require_(actor, MANAGE);
  const plan = await getPlanOr404(planKey);
  assertPlanOpen(plan);
  const suites = await planSuites(plan.id);
  const parentId = input.parentId ?? suites.find((s) => s.parentId === null)?.id;
  if (!parentId) throw conflict("This plan has no root suite");
  const error = suitePlacementError(suites, null, parentId);
  if (error) throw badRequest(error);
  const suite = await db.testSuite.create({
    data: { planId: plan.id, parentId, name: input.name, order: suites.filter((s) => s.parentId === parentId).length },
  });
  await audit({ userId: actor.id, action: "TEST_SUITE_CREATED", entityType: "TestSuite", entityId: suite.id, metadata: { plan: plan.key, name: suite.name } });
  return suite;
}

export async function updateSuite(actor: SessionUser, id: string, patch: z.infer<typeof updateSuiteSchema>) {
  require_(actor, MANAGE);
  const suite = await getSuiteOr404(id);
  assertPlanOpen(suite.plan);
  if (patch.parentId && patch.parentId !== suite.parentId) {
    if (suite.parentId === null) throw badRequest("The root suite cannot be moved");
    const error = suitePlacementError(await planSuites(suite.planId), suite.id, patch.parentId);
    if (error) throw badRequest(error);
  }
  const updated = await db.testSuite.update({ where: { id }, data: patch });
  await audit({ userId: actor.id, action: "TEST_SUITE_UPDATED", entityType: "TestSuite", entityId: id, metadata: { plan: suite.plan.key } });
  return updated;
}

export async function deleteSuite(actor: SessionUser, id: string) {
  require_(actor, MANAGE);
  const suite = await getSuiteOr404(id);
  assertPlanOpen(suite.plan);
  if (suite.parentId === null) throw badRequest("The root suite cannot be deleted. Delete the plan instead.");
  await db.testSuite.delete({ where: { id } }); // results stay on the case; pointId becomes null
  await audit({ userId: actor.id, action: "TEST_SUITE_DELETED", entityType: "TestSuite", entityId: id, metadata: { plan: suite.plan.key, name: suite.name } });
}

// --- Test points ----------------------------------------------------------------------

export async function addPoints(actor: SessionUser, suiteId: string, input: z.infer<typeof addPointsSchema>) {
  require_(actor, MANAGE);
  const suite = await getSuiteOr404(suiteId);
  assertPlanOpen(suite.plan);
  await assertActiveUser(input.testerId);

  const keys = [...new Set(input.testCaseKeys.map((k) => k.trim().toUpperCase()))];
  const configurations = [...new Set(input.configurations?.length ? input.configurations : [""])];
  if (keys.length * configurations.length > 500) throw badRequest("One request can create at most 500 test points");

  const cases = await db.testCase.findMany({ where: { key: { in: keys }, projectId: suite.plan.projectId, deletedAt: null }, select: { id: true, key: true, status: true } });
  const missing = keys.filter((k) => !cases.some((c) => c.key === k));
  if (missing.length) throw badRequest(`Test cases not found in this project: ${missing.join(", ")}`);
  const deprecated = cases.filter((c) => c.status === "DEPRECATED").map((c) => c.key);
  if (deprecated.length) throw conflict(`Deprecated test cases cannot be added: ${deprecated.join(", ")}`);

  const start = await db.testPoint.count({ where: { suiteId } });
  const rows = keys.flatMap((k) => configurations.map((configuration) => ({ key: k, configuration })));
  const { count } = await db.testPoint.createMany({
    data: rows.map((r, i) => ({ suiteId, testCaseId: cases.find((c) => c.key === r.key)!.id, configuration: r.configuration, testerId: input.testerId ?? null, order: start + i })),
    skipDuplicates: true,
  });
  await audit({ userId: actor.id, action: "TEST_POINTS_ADDED", entityType: "TestSuite", entityId: suiteId, metadata: { plan: suite.plan.key, added: count, skipped: rows.length - count } });
  return { added: count, skipped: rows.length - count };
}

async function getPointOr404(id: string) {
  const point = await db.testPoint.findUnique({ where: { id }, include: { suite: { include: { plan: true } } } });
  if (!point || point.suite.plan.deletedAt) throw notFound("Test point not found");
  return point;
}

export async function updatePoint(actor: SessionUser, id: string, input: z.infer<typeof updatePointSchema>) {
  require_(actor, MANAGE);
  const point = await getPointOr404(id);
  assertPlanOpen(point.suite.plan);
  await assertActiveUser(input.testerId);
  return db.testPoint.update({ where: { id }, data: { testerId: input.testerId } });
}

export async function deletePoint(actor: SessionUser, id: string) {
  require_(actor, MANAGE);
  const point = await getPointOr404(id);
  assertPlanOpen(point.suite.plan);
  await db.testPoint.delete({ where: { id } });
  await audit({ userId: actor.id, action: "TEST_POINT_REMOVED", entityType: "TestPoint", entityId: id, metadata: { plan: point.suite.plan.key } });
}

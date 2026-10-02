import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authRoute, parseBody, ok } from "@/lib/api";
import { forbidden } from "@/lib/errors";
import { ticketScopeFor, can } from "@/lib/rbac";
import { createTicket } from "@/lib/tickets/service";
import { serializeTicket } from "@/lib/tickets/serialize";
import { getSlaPolicy } from "@/lib/sla";
import { maybeRunBackgroundScan } from "@/lib/background";
import { remember } from "@/lib/cache";
import { withDbRetry } from "@/lib/db-retry";
import type { SessionUser } from "@/lib/auth/session";

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];

const listSchema = z.object({
  q: z.string().optional(),
  projectId: z.string().optional(),
  statusIds: z.string().optional(), // csv
  priorityIds: z.string().optional(),
  typeIds: z.string().optional(),
  assigneeId: z.string().optional(), // "me" | "unassigned" | userId | csv
  reporterId: z.string().optional(),
  labelId: z.string().optional(),
  sprintId: z.string().optional(),
  dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  overdue: z.string().optional(),
  sla: z.enum(["any", "breached", "at_risk", "on_track", "met"]).optional(),
  parentIdNull: z.string().optional(),
  sort: z.enum(["created_desc", "updated_desc", "due_asc", "priority_asc", "priority_desc", "key_asc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = authRoute(async (req, user) => {
  maybeRunBackgroundScan();
  const url = new URL(req.url);
  const cacheKey = `tickets:${user.id}:${url.search}`;
  return ok(await remember(cacheKey, 10_000, () => withDbRetry(() => listTickets(url, user))));
});

async function listTickets(url: URL, user: SessionUser) {
  const p = Object.fromEntries(url.searchParams.entries());
  const params = listSchema.parse(p);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;

  const and: Record<string, unknown>[] = [{ deletedAt: null }, ticketScopeFor(user)];

  if (params.q) {
    const isKeyLike = /^[A-Za-z]+-\d+$/.test(params.q.trim());
    and.push(isKeyLike
      ? { key: params.q.trim().toUpperCase() }
      : { OR: [
          { title: { contains: params.q, mode: "insensitive" as const } },
          { description: { contains: params.q, mode: "insensitive" as const } },
        ] });
  }
  if (params.projectId) and.push({ projectId: { in: params.projectId.split(",") } });
  if (params.statusIds) and.push({ statusId: { in: params.statusIds.split(",") } });
  if (params.priorityIds) and.push({ priorityId: { in: params.priorityIds.split(",") } });
  if (params.typeIds) and.push({ typeId: { in: params.typeIds.split(",") } });
  if (params.labelId) and.push({ labels: { some: { labelId: params.labelId } } });
  if (params.sprintId) and.push(params.sprintId === "none" ? { sprintId: null } : { sprintId: params.sprintId });
  if (params.reporterId === "me") and.push({ reporterId: user.id });
  else if (params.reporterId) and.push({ reporterId: params.reporterId });
  if (url.searchParams.get("watchedByMe") === "true") {
    and.push({ watchers: { some: { userId: user.id } }, assigneeId: { not: null } });
  }

  if (params.assigneeId === "me") and.push({ assigneeId: user.id });
  else if (params.assigneeId === "unassigned") and.push({ assigneeId: null });
  else if (params.assigneeId) and.push({ assigneeId: { in: params.assigneeId.split(",") } });

  if (params.overdue === "true") and.push({ dueDate: { lt: new Date() }, status: { category: { not: "DONE" } } });
  if (params.dueWithinDays !== undefined && !params.overdue) {
    const end = new Date(Date.now() + params.dueWithinDays * 86400000);
    and.push({ dueDate: { lte: end }, status: { category: { not: "DONE" } } });
  }
  if (params.sla && params.sla !== "any") {
    const now = new Date();
    const riskHorizon = new Date(now.getTime() + 24 * 3600000);
    // Filters mirror computeSla() exactly so list rows always match their badges
    if (params.sla === "breached") {
      and.push({ deletedAt: null, dueDate: { lt: now }, status: { category: { not: "DONE" } } });
    } else if (params.sla === "at_risk") {
      and.push({ deletedAt: null, dueDate: { gt: now, lte: riskHorizon }, status: { category: { not: "DONE" } } });
    } else if (params.sla === "on_track") {
      and.push({ deletedAt: null, dueDate: { gt: riskHorizon }, status: { category: { not: "DONE" } } });
    } else if (params.sla === "met") {
      and.push({ deletedAt: null, status: { category: "DONE" } });
    }
  }
  if (params.parentIdNull === "true") and.push({ parentId: null });

  const orderBy: Prisma.TicketOrderByWithRelationInput =
    params.sort === "updated_desc" ? { updatedAt: "desc" }
    : params.sort === "due_asc" ? { dueDate: "asc" }
    : params.sort === "priority_asc" ? { priority: { order: "asc" } }
    : params.sort === "priority_desc" ? { priority: { order: "desc" } }
    : params.sort === "key_asc" ? { key: "asc" }
    : { createdAt: "desc" };

  const slaPolicy = await getSlaPolicy();
  const [tickets, total] = await Promise.all([
    db.ticket.findMany({      where: { AND: and },
      include: {
        project: { select: { key: true, name: true } },
        type: true,
        status: true,
        priority: true,
        sprint: { select: { id: true, name: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        labels: { include: { label: true } },
        _count: { select: { comments: { where: { deletedAt: null } }, attachments: true, children: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.ticket.count({ where: { AND: and } }),
  ]);

  return {
    tickets: tickets.map((t) => serializeTicket(t, slaPolicy)),
    total, page, pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

const createSchema = z.object({
  projectId: z.string().min(1),
  typeId: z.string().min(1),
  title: z.string().min(3, "Title must be at least 3 characters").max(300),
  description: z.string().max(100000).optional(),
  statusId: z.string().optional(),
  priorityId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
  estimateMinutes: z.number().int().min(0).nullable().optional(),
  sprintId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
  watcherIds: z.array(z.string()).optional(),
});

export const POST = authRoute(async (req, user) => {
  const data = await parseBody(req, createSchema);
  if (!can(user, "*") && !can(user, "ticket.create")) {
    const allowed = data.parentId
      ? Boolean(await db.ticket.findFirst({ where: { id: data.parentId, OR: [{ assigneeId: user.id }, { reporterId: user.id }] } }))
      : false;
    if (!allowed) throw forbidden("You do not have permission to create tickets");
  }
  const ticket = await createTicket(user, {
    ...data,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    startDate: data.startDate ? new Date(data.startDate) : null,
    assigneeId: data.assigneeId || null,
    parentId: data.parentId || null,
    sprintId: data.sprintId || null,
  });
  return ok(ticket, { status: 201 });
});

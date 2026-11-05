import { z } from "zod";
import { db } from "@/lib/db";
import { authRoute, parseBody, ok } from "@/lib/api";
import { forbidden, notFound } from "@/lib/errors";
import { computeSla, getSlaPolicy } from "@/lib/sla";
import { updateTicket, archiveTicket, canViewTicket } from "@/lib/tickets/service";

type Ctx = { params: Promise<{ key: string }> };

export const GET = authRoute(async (_req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  const t = await db.ticket.findFirst({
    where: { key: key.toUpperCase(), deletedAt: null },
    include: {
      project: { select: { id: true, key: true, name: true, teamId: true } },
      type: true, status: true, priority: true,
      sprint: { select: { id: true, name: true } },
      reporter: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      assignee: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      parent: { select: { id: true, key: true, title: true } },
      children: {
        where: { deletedAt: null },
        include: { status: true, type: true, assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }, priority: true },
        orderBy: { createdAt: "asc" },
      },
      labels: { include: { label: true } },
      watchers: { include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } },
    },
  });
  if (!t) throw notFound("Ticket not found");

  // Scope check
  if (!(await canViewTicket(user, t.id))) throw forbidden("You do not have access to this ticket");

  const [comments, history, attachments] = await Promise.all([
    db.comment.findMany({
      where: { ticketId: t.id, deletedAt: null },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, jobTitle: true } },
        attachments: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.ticketHistory.findMany({
      where: { ticketId: t.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.attachment.findMany({ where: { ticketId: t.id }, include: { uploader: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" } }),
  ]);

  const emails = await db.emailEvent.findMany({
    where: { ticketId: t.id, direction: { in: ["OUTBOUND", "INBOUND"] }, NOT: { templateKey: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, direction: true, sender: true, recipients: true, subject: true, body: true, status: true, createdAt: true, sentAt: true, uploadedById: true },
  });

  return ok({
    ticket: {
      ...t,
      labels: t.labels.map((l) => l.label),
      watchers: t.watchers.map((w) => w.user),
      isWatching: t.watchers.some((w) => w.userId === user.id),
      sla: computeSla({ dueDate: t.dueDate, resolveDueAt: t.resolveDueAt, statusCategory: t.status.category }, await getSlaPolicy()),
    },
    comments,
    history,
    attachments,
    emails,
    permissions: {
      canEdit: canEdit(user, t.assigneeId, t.reporterId),
      canChangeStatus: canChangeStatus(user as any, t.assigneeId, t.reporterId, t.project.teamId),
      canAssign: canAssignCheck(user),
      canClaim: Boolean(t.assigneeId === null) && (user.permissions.includes("ticket.claim") || user.permissions.includes("*")),
      canDelete: user.permissions.includes("*") || user.permissions.includes("ticket.delete.team"),
    },
  });
});

function canEdit(user: { permissions: string[]; id: string; managedTeamIds?: string[] }, assigneeId: string | null, reporterId: string | null): boolean {
  if (user.permissions.includes("*")) return true;
  if (user.permissions.includes("ticket.edit.team")) return true;
  if (user.permissions.includes("ticket.edit.assigned")) return user.id === assigneeId || user.id === reporterId;
  return false;
}
function canChangeStatus(user: { permissions: string[]; id: string; teamId?: string | null }, assigneeId: string | null, reporterId: string | null, projectTeamId?: string | null): boolean {
  if (canEdit(user as any, assigneeId, reporterId)) return true;
  // Team members with edit.assigned can change status of any ticket in their team's project (board drag)
  if (user.permissions.includes("ticket.edit.assigned") && projectTeamId && user.teamId && user.teamId === projectTeamId) return true;
  return false;
}
function canAssignCheck(user: { permissions: string[] }): boolean {
  return user.permissions.includes("*") || user.permissions.includes("ticket.assign");
}

const patchSchema = z.object({
  title: z.string().min(3).max(300).optional(),
  description: z.string().max(100000).optional(),
  typeId: z.string().optional(),
  statusId: z.string().optional(),
  priorityId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
  estimateMinutes: z.number().int().min(0).nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

export const PATCH = authRoute(async (req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  const data = await parseBody(req, patchSchema);
  void forbidden;
  const updated = await updateTicket(user, key, {
    ...data,
    assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId || null,
    dueDate: data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
    startDate: data.startDate === undefined ? undefined : data.startDate ? new Date(data.startDate) : null,
  });
  return ok(updated);
});

export const DELETE = authRoute(async (_req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  await archiveTicket(user, key);
  return ok({ success: true });
});

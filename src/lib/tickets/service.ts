import { Prisma, Ticket } from "@prisma/client";
import { db } from "@/lib/db";
import { recordHistory } from "@/lib/history";
import { notify } from "@/lib/notify";
import { queueEmail } from "@/lib/email/send";
import { renderEmail } from "@/lib/email/templates";
import { APP_URL } from "@/lib/config";
import { conflict, forbidden, notFound, badRequest } from "@/lib/errors";
import { can } from "@/lib/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { excerpt, fmtDate, stripHtml } from "@/lib/utils";

type Tx = Prisma.TransactionClient;

const ticketInclude = {
  project: true,
  type: true,
  status: true,
  priority: true,
  reporter: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
  assignee: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
} satisfies Prisma.TicketInclude;
export type TicketWithRefs = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export async function getTicketOr404(keyOrId: string): Promise<TicketWithRefs> {
  const normalized = keyOrId.toUpperCase();
  let t = await db.ticket.findFirst({
    where: { key: normalized, deletedAt: null },
    include: ticketInclude,
  });
  if (!t) {
    t = await db.ticket.findFirst({
      where: { id: keyOrId, deletedAt: null },
      include: ticketInclude,
    });
  }
  if (!t) throw notFound("Ticket not found");
  return t;
}

async function findTicketByKeyOrId(keyOrId: string) {
  const normalized = keyOrId.toUpperCase();
  let t = await db.ticket.findFirst({ where: { key: normalized, deletedAt: null } });
  if (!t) t = await db.ticket.findFirst({ where: { id: keyOrId, deletedAt: null } });
  return t;
}

/** Users who should hear about changes to a ticket */
async function stakeholderIds(ticketId: string): Promise<string[]> {
  const t = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { assigneeId: true, reporterId: true, watchers: { select: { userId: true } } },
  });
  if (!t) return [];
  const ids = new Set<string>();
  if (t.assigneeId) ids.add(t.assigneeId);
  if (t.reporterId) ids.add(t.reporterId);
  t.watchers.forEach((w) => ids.add(w.userId));
  return [...ids];
}

async function managerOfTeam(teamId?: string | null): Promise<string | null> {
  if (!teamId) return null;
  const team = await db.team.findUnique({ where: { id: teamId }, select: { managerId: true } });
  return team?.managerId ?? null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateTicketInput = {
  projectId: string; typeId: string; title: string; description?: string;
  statusId?: string; priorityId?: string; assigneeId?: string | null;
  dueDate?: Date | null; startDate?: Date | null; storyPoints?: number | null;
  estimateMinutes?: number | null; sprintId?: string | null; parentId?: string | null;
  labelIds?: string[]; watcherIds?: string[];
};

export async function createTicket(actor: SessionUser, input: CreateTicketInput): Promise<TicketWithRefs> {
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw notFound("Project not found");

  // Permission: ticket.create holders (admins/managers) may create in any active project;
  // employees without ticket.create may only add subtasks under tickets they participate in.
  if (!can(actor, "*") && !can(actor, "ticket.create")) {
    if (!input.parentId) throw forbidden("You do not have permission to create tickets in this project");
    const parent = await db.ticket.findFirst({
      where: { id: input.parentId, deletedAt: null, OR: [{ assigneeId: actor.id }, { reporterId: actor.id }] },
    });
    if (!parent) throw forbidden("You can only create sub-tasks under your own tickets");
  }

  const defaultStatus = await db.status.findFirst({ where: { isDefault: true } });

  const created = await (async () => {
    // Atomic per-project numbering WITHOUT an interactive transaction:
    // UPDATE ... RETURNING is a single atomic statement (row-locked by Postgres),
    // reliable through connection poolers like Supabase's PgBouncer.
    // Defensive retry: a drifted counter can theoretically hand out an existing
    // key; the unique index rejects it and we simply take the next number.
    const { getSlaPolicy, targetHoursFor } = await import("@/lib/sla");
    const slaPolicy = await getSlaPolicy();
    const targetHoursBase = targetHoursFor(slaPolicy, input.priorityId ?? null);
    const now = new Date();
    let resolveDueAt =
      slaPolicy.enabled && targetHoursBase != null && !input.dueDate
        ? new Date(now.getTime() + targetHoursBase * 3600000)
        : null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const rows = await db.$queryRaw<{ num: number }[]>`
        UPDATE "Project" SET "nextNumber" = "nextNumber" + 1
        WHERE id = ${project.id}
        RETURNING "nextNumber" AS num`;
      if (!rows.length) throw notFound("Project not found");
      const nextNumber = Number(rows[0].num);

      try {
        const ticket = await db.ticket.create({
          data: {
            key: `${project.key}-${nextNumber}`,
            number: nextNumber,
            projectId: project.id,
            typeId: input.typeId,
            statusId: input.statusId ?? defaultStatus?.id ?? (await db.status.findFirstOrThrow()).id,
            priorityId:
              input.priorityId ??
              (await db.priority.findFirst({ where: { isDefault: true } }))!.id,
            title: input.title.trim(),
            description: input.description ?? "",
            reporterId: actor.id,
            assigneeId: input.assigneeId || null,
            dueDate: input.dueDate ?? null,
            startDate: input.startDate ?? null,
            storyPoints: input.storyPoints ?? null,
            estimateMinutes: input.estimateMinutes ?? null,
            sprintId: input.sprintId || null,
            parentId: input.parentId || null,
            resolveDueAt,
          },
        });

        if (resolveDueAt) {
          await recordHistory(db, {
            ticketId: ticket.id,
            userId: actor.id,
            field: "sla",
            oldValue: null,
            newValue: `target ${targetHoursBase}h`,
            message: "SLA resolution target applied from priority policy",
          }).catch(() => {});
        }
        if (input.labelIds?.length) {
          await db.ticketLabel.createMany({ data: input.labelIds.map((labelId) => ({ ticketId: ticket.id, labelId })) }).catch(() => {});
        }
        const watchers = new Set([actor.id, ...(input.watcherIds ?? [])]);
        await db.ticketWatcher.createMany({ data: [...watchers].map((userId) => ({ ticketId: ticket.id, userId })) }).catch(() => {});
        await recordHistory(db, { ticketId: ticket.id, userId: actor.id, field: "created", newValue: "created", message: `Created ticket ${ticket.key}` }).catch(() => {});
        return ticket;
      } catch (e) {
        const isKeyCollision =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
        if (!isKeyCollision || attempt === 4) throw e;
        console.warn(`[tickets] key collision at ${project.key}-${nextNumber}, retrying`);
      }
    }
    throw badRequest("Could not allocate a ticket number");
  })();

  await afterCreate(actor, created.id);
  return getTicketOr404(created.key);
}

async function afterCreate(actor: SessionUser, ticketId: string) {
  const t = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { project: true, type: true, priority: true, reporter: true, assignee: true },
  });
  if (!t) return;
  const varsBase = baseVars(t as never, actor);

  if (t.assigneeId) {
    await notify({
      userIds: [t.assigneeId], actorId: actor.id, type: "TICKET_ASSIGNED",
      title: `New ticket assigned to you - ${t.key}`, body: t.title, ticketId: t.id,
    });
    const email = await renderEmail("ticket_assigned", varsBase);
    await queueEmail({ to: t.assignee?.email, templateKey: "ticket_assigned", ...email, ticketId: t.id });
  }
}

export function baseVars(t: TicketWithRefs, actor?: SessionUser | { firstName: string; lastName: string } | null) {
  return {
    ticket_key: t.key,
    ticket_title: t.title,
    ticket_id: t.key,
    ticket_url: `${APP_URL}/tickets/${t.key}`,
    project_name: t.project.name,
    project_key: t.project.key,
    priority: t.priority?.name ?? "",
    status: t.status?.name ?? "",
    due_date: t.dueDate ? fmtDate(t.dueDate) : "None",
    reporter_name: t.reporter ? `${t.reporter.firstName} ${t.reporter.lastName}` : "",
    assignee_name: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : "",
    actor_name: actor ? `${actor.firstName} ${actor.lastName}` : "Someone",
    description_summary: excerpt(stripHtml(t.description || ""), 200),
  };
}

// ---------------------------------------------------------------------------
// Update fields (generic diff -> history + notifications + emails)
// ---------------------------------------------------------------------------

type FieldSpec = {
  field: keyof Ticket;
  label: string;
  render?: (v: unknown) => string | null | Promise<string | null>;
};

const FIELDS: Record<string, FieldSpec> = {
  title: { field: "title", label: "title" },
  description: { field: "description", label: "description" },
  typeId: { field: "typeId", label: "type", render: lookupName("ticketType") },
  statusId: { field: "statusId", label: "status", render: lookupName("status") },
  priorityId: { field: "priorityId", label: "priority", render: lookupName("priority") },
  assigneeId: { field: "assigneeId", label: "assignee", render: userLookup },
  sprintId: { field: "sprintId", label: "sprint", render: lookupName("sprint") },
  dueDate: { field: "dueDate", label: "due date", render: (v) => (v instanceof Date ? fmtDate(v) : v == null ? "None" : String(v)) },
  startDate: { field: "startDate", label: "start date", render: (v) => (v instanceof Date ? fmtDate(v) : v == null ? "None" : String(v)) },
  storyPoints: { field: "storyPoints", label: "story points" },
  estimateMinutes: { field: "estimateMinutes", label: "estimate" },
};

function lookupName(model: "status" | "priority" | "ticketType" | "sprint") {
  return async (v: unknown) => {
    if (typeof v !== "string") return null;
    const rec = await (db as never as Record<string, { findUnique(a: unknown): Promise<{ name?: string } | null> }>)[model].findUnique({ where: { id: v } });
    return rec?.name ?? null;
  };
}
async function userLookup(v: unknown): Promise<string | null> {
  if (typeof v !== "string") return "Unassigned";
  const u = await db.user.findUnique({ where: { id: v } });
  return u ? `${u.firstName} ${u.lastName}` : "Unassigned";
}

export type UpdateTicketPatch = Partial<{
  title: string; description: string; typeId: string; statusId: string; priorityId: string;
  assigneeId: string | null; sprintId: string | null; dueDate: Date | null; startDate: Date | null;
  storyPoints: number | null; estimateMinutes: number | null; labelIds: string[];
}>;

export async function updateTicket(actor: SessionUser, key: string, patch: UpdateTicketPatch): Promise<TicketWithRefs> {
  const before = await getTicketOr404(key);

  // Permission checks
  const isAdmin = can(actor, "*");
  const canEditAny = can(actor, "ticket.edit.team");
  const involved = before.assigneeId === actor.id || before.reporterId === actor.id;
  const isStatusOnlyChange =
    Object.keys(patch).length === 1 && (patch as Record<string, unknown>).statusId !== undefined;
  const sameTeam = Boolean(actor.teamId && before.project.teamId && actor.teamId === before.project.teamId);
  // Allow: admin, or manager (edit.team), or involved employee (edit.assigned), or team-member moving status on board
  const canEdit =
    isAdmin ||
    canEditAny ||
    (involved && can(actor, "ticket.edit.assigned")) ||
    (isStatusOnlyChange && sameTeam && can(actor, "ticket.edit.assigned"));
  if (!canEdit) {
    throw forbidden();
  }

  const { labelIds, ...rest } = patch;
  const data: Record<string, unknown> = {};
  const changes: { spec: FieldSpec; oldVal: unknown; newVal: unknown }[] = [];

  for (const [k, v] of Object.entries(rest)) {
    const spec = FIELDS[k];
    if (!spec || v === undefined) continue;
    const current = (before as Record<string, unknown>)[k];
    const changed =
      v instanceof Date || current instanceof Date
        ? !(v instanceof Date && current instanceof Date && v.getTime() === current.getTime())
        : JSON.stringify(v ?? null) !== JSON.stringify(current ?? null);
    if (!changed) continue;
    data[k] = v;
    changes.push({ spec, oldVal: current, newVal: v });
  }

  // Validate FKs early to return 400 instead of 500 (P2003)
  if (data.statusId) {
    const s = await db.status.findUnique({ where: { id: String(data.statusId) } });
    if (!s) throw badRequest("Invalid status");
  }
  if (data.priorityId) {
    const p = await db.priority.findUnique({ where: { id: String(data.priorityId) } });
    if (!p) throw badRequest("Invalid priority");
  }
  if (data.typeId) {
    const t = await db.ticketType.findUnique({ where: { id: String(data.typeId) } });
    if (!t) throw badRequest("Invalid ticket type");
  }
  if (data.sprintId) {
    const s = await db.sprint.findUnique({ where: { id: String(data.sprintId) } });
    if (!s) throw badRequest("Invalid sprint");
  }
  if (data.assigneeId) {
    const u = await db.user.findUnique({ where: { id: String(data.assigneeId) } });
    if (!u) throw badRequest("Assignee not found");
    if (u.status === "DISABLED") throw badRequest("Cannot assign to a disabled user");
  }

  // Use non-interactive sequential updates to stay compatible with PgBouncer transaction pooling
  // (Supabase pooler at 6543). Interactive $transaction(async tx=>) fails with "Response from the Engine was empty".
  let updated: TicketWithRefs = before;
  if (Object.keys(data).length) {
    try {
      updated = (await db.ticket.update({ where: { id: before.id }, data, include: ticketInclude })) as unknown as typeof before;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw badRequest("Invalid reference (foreign key violation)");
      }
      throw e;
    }
  }
  // Priority changed -> re-derive the SLA target (only when no manual due date governs)
  const priorityChange = changes.find((c) => c.spec.label === "priority");
  if (priorityChange && !before.dueDate) {
    const { getSlaPolicy, targetHoursFor } = await import("@/lib/sla");
    const slaPolicy = await getSlaPolicy();
    const newHours = targetHoursFor(slaPolicy, String(priorityChange.newVal));
    if (slaPolicy.enabled && newHours != null) {
      const newTarget = new Date(Date.now() + newHours * 3600000);
      await db.ticket.update({ where: { id: before.id }, data: { resolveDueAt: newTarget } });
      await recordHistory(db, {
        ticketId: before.id,
        userId: actor.id,
        field: "sla",
        oldValue: null,
        newValue: `target ${newHours}h`,
        message: "SLA target re-applied after priority change",
      });
      updated = { ...updated, resolveDueAt: newTarget } as unknown as typeof before;
    }
  }
  for (const c of changes) {
    const [oldName, newName] = await Promise.all([
      c.spec.render ? c.spec.render(c.oldVal) : Promise.resolve(String(c.oldVal ?? "")),
      c.spec.render ? c.spec.render(c.newVal) : Promise.resolve(String(c.newVal ?? "")),
    ]);
    await recordHistory(db, {
      ticketId: before.id, userId: actor.id, field: c.spec.label,
      oldValue: oldName, newValue: newName,
    });
  }
  if (Array.isArray(labelIds)) {
    await db.ticketLabel.deleteMany({ where: { ticketId: before.id } });
    if (labelIds.length) await db.ticketLabel.createMany({ data: labelIds.map((id) => ({ ticketId: before.id, labelId: id })) });
    const names = await db.label.findMany({ where: { id: { in: labelIds } } });
    await recordHistory(db, { ticketId: before.id, userId: actor.id, field: "labels", oldValue: "", newValue: names.map((n) => n.name).join(", ") });
  }

  await afterUpdate(actor, before, updated, changes.map((c) => c.spec.label));
  return updated;
}

async function afterUpdate(actor: SessionUser, before: TicketWithRefs, after: TicketWithRefs, changedFields: string[]) {
  const stakeholders = await stakeholderIds(after.id);
  const vars = baseVars(after, actor);
  const oldVars = { ...vars, old_value: "" };

  for (const f of changedFields) {
    switch (f) {
      case "assignee": {
        const prevAssignee = before.assigneeId;
        if (after.assigneeId && after.assigneeId !== prevAssignee) {
          await notify({ userIds: [after.assigneeId], actorId: actor.id, type: prevAssignee ? "TICKET_REASSIGNED" : "TICKET_ASSIGNED", title: `${prevAssignee ? "Ticket reassigned to you" : "New ticket assigned to you"} - ${after.key}`, body: after.title, ticketId: after.id });
          const tplKey = prevAssignee ? ("ticket_reassigned" as const) : ("ticket_assigned" as const);
          const email = await renderEmail(tplKey, vars);
          await queueEmail({ to: after.assignee?.email, templateKey: tplKey, ...email, ticketId: after.id });
          if (prevAssignee) {
            const prev = await db.user.findUnique({ where: { id: prevAssignee } });
            const prevEmail = await renderEmail(tplKey, vars);
            await queueEmail({ to: prev?.email, templateKey: tplKey, subject: `[${after.key}] Ticket reassigned away from you`, html: prevEmail.html, ticketId: after.id });
          }
          const mgrId = await managerOfTeam(after.project.teamId);
          if (mgrId) {
            await notify({ userIds: [mgrId], actorId: actor.id, type: "TICKET_ASSIGNED", title: `${after.key} assigned`, body: `${after.assignee?.firstName} now owns ${after.title}`, ticketId: after.id });
          }
        } else if (!after.assigneeId && prevAssignee) {
          await recordHistory(db, { ticketId: after.id, userId: actor.id, field: "assignee", oldValue: vars.assignee_name, newValue: "Unassigned" });
        }
        break;
      }
      case "status": {
        const resolved = ["Resolved", "Done", "Closed"].includes(after.status.name);
        const reopened = ["Reopened"].includes(after.status.name) || (before.status.category === "DONE" && after.status.category !== "DONE");
        await notify({ userIds: stakeholders, actorId: actor.id, type: "STATUS_CHANGED", title: `Status changed to ${after.status.name}`, body: `${after.key}: ${before.status.name} -> ${after.status.name}`, ticketId: after.id });
        const email = await renderEmail("status_changed", { ...vars, old_value: before.status.name, new_value: after.status.name });
        const recipients = await db.user.findMany({ where: { id: { in: stakeholders } }, select: { id: true, email: true } });
        // Fire in parallel - sequential awaits made every status change crawl
        await Promise.all(
          recipients.map((u) => queueEmail({ to: u.email, templateKey: "status_changed", ...email, ticketId: after.id }))
        );
        if (resolved) {
          await notify({ userIds: [after.reporterId], actorId: actor.id, type: "TICKET_RESOLVED", title: `Your ticket was resolved: ${after.key}`, body: after.title, ticketId: after.id });
          const rEmail = await renderEmail("ticket_resolved", vars);
          await queueEmail({ to: after.reporter?.email, templateKey: "ticket_resolved", ...rEmail, ticketId: after.id });
        }
        if (reopened) {
          await db.ticket.update({ where: { id: after.id }, data: { reopenedCount: { increment: 1 } } });
          await notify({ userIds: [after.assigneeId], actorId: actor.id, type: "TICKET_REOPENED", title: `Ticket reopened: ${after.key}`, body: after.title, ticketId: after.id });
          const roEmail = await renderEmail("ticket_reopened", vars);
          await queueEmail({ to: after.assignee?.email, templateKey: "ticket_reopened", ...roEmail, ticketId: after.id });
        }
        break;
      }
      case "priority": {
        await notify({ userIds: stakeholders, actorId: actor.id, type: "PRIORITY_CHANGED", title: `Priority changed to ${after.priority.name}`, body: `${after.key}: ${after.title}`, ticketId: after.id });
        const pEmail = await renderEmail("priority_changed", { ...vars, old_value: before.priority?.name ?? "", new_value: after.priority.name });
        const recipients = await db.user.findMany({ where: { id: { in: stakeholders } }, select: { id: true, email: true } });
        await Promise.all(
          recipients.map((u) => queueEmail({ to: u.email, templateKey: "priority_changed", ...pEmail, ticketId: after.id }))
        );
        break;
      }
      case "due date": {
        await notify({ userIds: [after.assigneeId], actorId: actor.id, type: "DUE_CHANGED", title: `Due date changed on ${after.key}`, body: `Now due ${vars.due_date}`, ticketId: after.id });
        const dEmail = await renderEmail("due_date_changed", { ...vars, new_value: vars.due_date });
        await queueEmail({ to: after.assignee?.email, templateKey: "due_date_changed", ...dEmail, ticketId: after.id });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Assign / Claim (atomic)
// ---------------------------------------------------------------------------

export async function assignTicket(actor: SessionUser, key: string, assigneeId: string | null) {
  const ticket = await getTicketOr404(key);
  if (!can(actor, "*") && !can(actor, "ticket.assign")) throw forbidden("You cannot assign tickets");
  if (assigneeId) {
    const target = await db.user.findUnique({ where: { id: assigneeId } });
    if (!target) throw notFound("User not found");
    if (target.status === "DISABLED") throw badRequest("Cannot assign to a disabled user");
  }
  return updateTicket(actor, key, { assigneeId });
}

/**
 * Self-claim with guaranteed single-winner semantics:
 * a conditional atomic UPDATE inside a transaction. If two users race,
 * exactly one UPDATE matches assigneeId IS NULL; the other gets count=0 -> 409.
 */
export async function claimTicket(actor: SessionUser, key: string) {
  if (!can(actor, "ticket.claim") && !can(actor, "*")) throw forbidden("You cannot claim tickets");
  if (actor.status === "DISABLED") throw forbidden("Disabled users cannot claim tickets");

  const ticket = await findTicketByKeyOrId(key);
  if (!ticket) throw notFound("Ticket not found");

  const result = await db.$transaction(async (tx) => {
    const res = await tx.ticket.updateMany({
      where: { id: ticket.id, assigneeId: null, deletedAt: null },
      data: { assigneeId: actor.id },
    });
    if (res.count === 0) {
      throw conflict(`Unable to claim ticket. It was already claimed by another user.`);
    }
    await recordHistory(tx, { ticketId: ticket.id, userId: actor.id, field: "assignee", oldValue: "Unassigned", newValue: `${actor.firstName} ${actor.lastName}`, message: "Picked up via Available Work" });
    await tx.ticketWatcher.create({ data: { ticketId: ticket.id, userId: actor.id } }).catch(() => {});
    return true;
  });

  const fresh = await getTicketOr404(key);
  const mgrId = await managerOfTeam(fresh.project.teamId);
  if (mgrId) {
    await notify({ userIds: [mgrId], actorId: actor.id, type: "TICKET_CLAIMED", title: `${fresh.key} picked up`, body: `${actor.firstName} ${actor.lastName} claimed "${fresh.title}"`, ticketId: fresh.id });
  }
  await notify({ userIds: [fresh.reporterId], actorId: actor.id, type: "TICKET_CLAIMED", title: `${fresh.key} picked up`, body: `${actor.firstName} ${actor.lastName} claimed your ticket "${fresh.title}"`, ticketId: fresh.id });
  const email = await renderEmail("ticket_assigned", { ...baseVars(fresh, actor), assignee_name: `${actor.firstName} ${actor.lastName}` });
  await queueEmail({ to: actor.email, templateKey: "ticket_assigned", subject: `Confirmed: You picked up ${fresh.key}`, html: email.html, ticketId: fresh.id });

  publishTicketChange(fresh.id);
  return fresh;
}

// ---------------------------------------------------------------------------
// Comments + mentions
// ---------------------------------------------------------------------------

export function extractMentions(htmlBody: string, allUsers: { id: string; firstName: string; lastName: string; email: string }[]): string[] {
  const plain = stripHtml(htmlBody);
  const tokens = [...plain.matchAll(/@([\w.-]+)/g)].map((m) => m[1].toLowerCase());
  const ids = new Set<string>();
  for (const tok of tokens) {
    const user = allUsers.find(
      (u) =>
        u.email.split("@")[0].toLowerCase() === tok ||
        u.firstName.toLowerCase() === tok ||
        `${u.firstName}${u.lastName}`.toLowerCase() === tok ||
        `${u.firstName}.${u.lastName}`.toLowerCase() === tok
    );
    if (user) ids.add(user.id);
  }
  return [...ids];
}

export async function addComment(actor: SessionUser, key: string, body: string, parentId?: string | null) {
  if (!can(actor, "ticket.comment") && !can(actor, "*")) throw forbidden();
  const ticket = await getTicketOr404(key);

  const comment = await db.comment.create({ data: { ticketId: ticket.id, authorId: actor.id, body, parentId: parentId || null } });
  await db.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
  await recordHistory(db, { ticketId: ticket.id, userId: actor.id, field: "comment", newValue: excerpt(stripHtml(body), 120), message: "Comment added" });

  const allUsers = await db.user.findMany({ where: { status: { not: "DISABLED" } }, select: { id: true, firstName: true, lastName: true, email: true } });
  const mentioned = extractMentions(body, allUsers);
  const stakeholders = (await stakeholderIds(ticket.id)).filter((id) => id !== comment.authorId);

  await notify({ userIds: stakeholders, actorId: actor.id, type: "COMMENT_ADDED", title: `New comment on ${ticket.key}`, body: `${actor.firstName} commented: ${excerpt(stripHtml(body), 100)}`, ticketId: ticket.id });
  const cEmail = await renderEmail("comment_added", { ...baseVars(ticket, actor), comment_body: excerpt(stripHtml(body), 300) });
  for (const uid of stakeholders) {
    const u = allUsers.find((x) => x.id === uid);
    if (u) await queueEmail({ to: u.email, templateKey: "comment_added", ...cEmail, ticketId: ticket.id });
  }
  const mentionTargets = mentioned.filter((id) => id !== actor.id && !stakeholders.includes(id));
  await notify({ userIds: mentionTargets, actorId: actor.id, type: "MENTION", title: `You were mentioned on ${ticket.key}`, body: `${actor.firstName} mentioned you in a comment`, ticketId: ticket.id });
  const mEmail = await renderEmail("mention", { ...baseVars(ticket, actor), comment_body: excerpt(stripHtml(body), 300) });
  for (const uid of mentioned) {
    const u = allUsers.find((x) => x.id === uid);
    if (u) await queueEmail({ to: u.email, templateKey: "mention", ...mEmail, ticketId: ticket.id });
  }
  publishTicketChange(ticket.id);
  return comment;
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

export async function setWatching(actor: SessionUser, key: string, watching: boolean) {
  const ticket = await getTicketOr404(key);
  if (watching) {
    await db.ticketWatcher.upsert({
      where: { ticketId_userId: { ticketId: ticket.id, userId: actor.id } },
      create: { ticketId: ticket.id, userId: actor.id },
      update: {},
    });
  } else {
    await db.ticketWatcher.deleteMany({ where: { ticketId: ticket.id, userId: actor.id } });
  }
  return getTicketOr404(key);
}

// ---------------------------------------------------------------------------
// Soft delete (archive)
// ---------------------------------------------------------------------------

export async function archiveTicket(actor: SessionUser, key: string) {
  const ticket = await getTicketOr404(key);
  if (!can(actor, "*") && !can(actor, "ticket.delete.team")) throw forbidden();
  await db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticket.id }, data: { deletedAt: new Date() } });
    await recordHistory(tx, { ticketId: ticket.id, userId: actor.id, field: "deleted", newValue: "archived" });
  });
  await db.auditLog.create({ data: { userId: actor.id, action: "TICKET_ARCHIVED", entityType: "Ticket", entityId: ticket.id, metadata: { key: ticket.key } } });
}

export function publishTicketChange(ticketId: string) {
  import("@/lib/events").then(({ publish }) => publish({ type: "ticket", userIds: [], payload: { ticketId } }));
}

import { db } from "@/lib/db";
import { authRoute, ok } from "@/lib/api";
import { forbidden } from "@/lib/errors";
import { ticketScopeFor, can, isSuperAdmin } from "@/lib/rbac";
import { toCsv } from "@/lib/utils";

const DAY = 86400000;

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];

export const GET = authRoute(async (req, user) => {
  if (!can(user, "report.view.team") && !can(user, "report.view.all") && !isSuperAdmin(user)) throw forbidden("You do not have access to reports");
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "overview";
  const days = Number(url.searchParams.get("days") ?? 30);
  const since = new Date(Date.now() - days * DAY);
  const scope = ticketScopeFor(user);

  switch (type) {
    case "workload": {
      const users = await db.user.findMany({
        where: user.teamId ? { teamId: user.teamId } : {},
        select: { id: true, firstName: true, lastName: true, jobTitle: true },
        orderBy: { firstName: "asc" },
      });
      const rows = await Promise.all(users.map(async (u) => {
        const [open, done, overdue, inProgress] = await Promise.all([
          db.ticket.count({ where: { assigneeId: u.id, deletedAt: null, status: { category: { not: "DONE" } }, ...(user.teamId ? { project: { teamId: user.teamId } } : scope) } }),
          db.ticket.count({ where: { assigneeId: u.id, deletedAt: null, status: { category: "DONE" }, updatedAt: { gte: since } } }),
          db.ticket.count({ where: { assigneeId: u.id, deletedAt: null, dueDate: { lt: new Date() }, status: { category: { not: "DONE" } } } }),
          db.ticket.count({ where: { assigneeId: u.id, deletedAt: null, status: { name: "In Progress" } } }),
        ]);
        const doneTickets = await db.ticket.findMany({
          where: { assigneeId: u.id, deletedAt: null, status: { category: "DONE" }, updatedAt: { gte: since } },
          select: { createdAt: true, updatedAt: true }, take: 300,
        });
        const avgDays = doneTickets.length ? doneTickets.reduce((a, t) => a + (t.updatedAt.getTime() - t.createdAt.getTime()) / DAY, 0) / doneTickets.length : null;
        return {
          name: `${u.firstName} ${u.lastName}`, jobTitle: u.jobTitle ?? "", open, done, overdue, inProgress,
          completionRate: open + done > 0 ? Math.round((done / (open + done)) * 100) : null,
          avgResolutionDays: avgDays !== null ? Number(avgDays.toFixed(1)) : null,
        };
      }));
      return maybeCsv(url, rows, ["name", "jobTitle", "open", "inProgress", "done", "overdue", "completionRate", "avgResolutionDays"], "workload");
    }
    case "aging": {
      const tickets = await db.ticket.findMany({
        where: { AND: [scope, { deletedAt: null }, { status: { category: { not: "DONE" } } }] },
        include: { assignee: { select: { firstName: true, lastName: true } }, priority: true },
        orderBy: { createdAt: "asc" }, take: 500,
      });
      const rows = tickets.map((t) => ({
        key: t.key, title: t.title, priority: t.priority.name,
        assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : "Unassigned",
        ageDays: Math.floor((Date.now() - t.createdAt.getTime()) / DAY),
        bucket: Math.floor((Date.now() - t.createdAt.getTime()) / DAY) < 7 ? "<1 week"
          : Math.floor((Date.now() - t.createdAt.getTime()) / DAY) < 14 ? "1-2 weeks"
          : Math.floor((Date.now() - t.createdAt.getTime()) / DAY) < 30 ? "2-4 weeks" : ">1 month",
      }));
      return maybeCsv(url, rows, ["key", "title", "priority", "assignee", "ageDays", "bucket"], "aging");
    }
    case "created-completed": {
      const createdRows = await db.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS count FROM "Ticket"
        WHERE "deletedAt" IS NULL AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`;
      const completedRows = await db.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', t."updatedAt") AS day, count(*) FROM "Ticket" t
        JOIN "Status" s ON s.id = t."statusId"
        WHERE t."deletedAt" IS NULL AND s.category='DONE' AND t."updatedAt" >= ${since} GROUP BY 1 ORDER BY 1`;
      const rows: Record<string, unknown>[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const key = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
        const c = createdRows.find((r) => new Date(r.day).toISOString().slice(0, 10) === key);
        const f = completedRows.find((r) => new Date(r.day).toISOString().slice(0, 10) === key);
        rows.push({ day: key, created: Number(c?.count ?? 0), completed: Number(f?.count ?? 0) });
      }
      return maybeCsv(url, rows, ["day", "created", "completed"], "created-vs-completed");
    }
    case "user-trend": {
      const userId = url.searchParams.get("userId");
      if (!userId) return ok({ rows: [] });
      const rows2 = await db.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', t."createdAt") AS day, count(*) FROM "Ticket" t
        WHERE t."deletedAt" IS NULL AND t."assigneeId" = ${userId} AND t."createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`;
      const out: Record<string, unknown>[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const key = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
        const c = rows2.find((r) => new Date(r.day).toISOString().slice(0, 10) === key);
        out.push({ day: key.slice(5), created: Number(c?.count ?? 0) });
      }
      return ok({ rows: out });
    }
    default: {
      const [byStatusRaw, byPriorityRaw, byAssigneeRaw, reopenedCount] = await Promise.all([
        db.ticket.groupBy({ by: ["statusId"], where: { AND: [scope, { deletedAt: null }] }, _count: true }),
        db.ticket.groupBy({ by: ["priorityId"], where: { AND: [scope, { deletedAt: null }] }, _count: true }),
        db.ticket.groupBy({ by: ["assigneeId"], where: { AND: [scope, { deletedAt: null }] }, _count: true }),
        db.ticket.count({ where: { AND: [scope, { deletedAt: null }], reopenedCount: { gt: 0 } } }),
      ]);
      const [statuses, priorities, users] = await Promise.all([db.status.findMany(), db.priority.findMany(), db.user.findMany()]);
      const total = byStatusRaw.reduce((a, r) => a + r._count, 0);
      const doneCount = byStatusRaw.filter((r) => statuses.find((s) => s.id === r.statusId)?.category === "DONE").reduce((a, r) => a + r._count, 0);
      const rows = [
        ...byStatusRaw.map((r) => ({ metric: `Status: ${statuses.find((s) => s.id === r.statusId)?.name}`, count: r._count })),
        ...byPriorityRaw.map((r) => ({ metric: `Priority: ${priorities.find((p) => p.id === r.priorityId)?.name}`, count: r._count })),
        ...byAssigneeRaw.map((r) => ({ metric: `Assignee: ${users.find((u) => u.id === r.assigneeId)?.firstName ?? "Unassigned"} ${users.find((u) => u.id === r.assigneeId)?.lastName ?? ""}`.trimEnd(), count: r._count })),
        { metric: "Total tickets", count: total },
        { metric: "Completion rate %", count: total ? Math.round((doneCount / total) * 100) : 0 },
        { metric: "Reopened tickets", count: reopenedCount },
      ];
      return maybeCsv(url, rows, ["metric", "count"], "overview");
    }
  }
});

function maybeCsv(url: URL, rows: Record<string, unknown>[], headers: string[], name: string): Response {
  if (url.searchParams.get("export") === "csv") {
    return new Response(toCsv(rows, headers), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="strike-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return ok({ type: name, rows });
}

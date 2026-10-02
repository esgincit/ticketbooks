import { db } from "@/lib/db";
import { authRoute, ok } from "@/lib/api";
import { ticketScopeFor, can, isSuperAdmin } from "@/lib/rbac";
import { maybeRunBackgroundScan } from "@/lib/background";
import { remember } from "@/lib/cache";
import { withDbRetry } from "@/lib/db-retry";
import type { SessionUser } from "@/lib/auth/session";

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];

const DAY = 86400000;
const CACHE_MS = 30_000;

export const GET = authRoute(async (_req, user) => {
  maybeRunBackgroundScan();
  return ok(await remember(`dash:${user.id}`, CACHE_MS, () => withDbRetry(() => buildDashboard(user))));
});

async function buildDashboard(user: SessionUser) {
  const scope = ticketScopeFor(user);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + DAY);
  const openCat = { status: { category: { not: "DONE" } }, deletedAt: null };

  const isManagerish = can(user, "report.view.team") || can(user, "report.view.all") || isSuperAdmin(user);
  const mine = { assigneeId: user.id };

  if (isManagerish) {
    const since = new Date(startOfToday.getTime() - 13 * DAY);
    const teamId = user.managedTeamIds[0] ?? user.teamId;

    const [teamUsers, teamProjects] = await Promise.all([
      teamId
        ? db.user.findMany({ where: { teamId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, avatarUrl: true } })
        : Promise.resolve([] as { id: string; firstName: string; lastName: string; avatarUrl: string | null }[]),
      teamId
        ? db.project.findMany({ where: { teamId }, select: { id: true } })
        : Promise.resolve([] as { id: string }[]),
    ]);
    const teamUserIds = teamUsers.map((u) => u.id);
    const teamProjectIds = teamProjects.map((p) => p.id);

    // Every round-trip in a single parallel batch (was ~40 queries incl. N+1 per member)
    const [
      totalOpen, unassigned, completed, overdue, dueToday, assignedToMe,
      byStatusRaw, byPriorityRaw, statuses, priorities, prioritiesAll,
      recent, doneRecent,
      createdRows, completedRows,
      openByAssignee, doneByAssignee, overdueByAssignee,
    ] = await Promise.all([
      db.ticket.count({ where: { AND: [scope, openCat] } }),
      db.ticket.count({ where: { AND: [scope, openCat, { assigneeId: null }] } }),
      db.ticket.count({ where: { AND: [scope, { deletedAt: null }, { status: { category: "DONE" } }] } }),
      db.ticket.count({ where: { AND: [scope, openCat, { dueDate: { lt: startOfToday } }] } }),
      db.ticket.count({ where: { AND: [scope, openCat, { dueDate: { gte: startOfToday, lt: endOfToday } }] } }),
      db.ticket.count({ where: { AND: [mine, openCat, scope] } }),
      db.ticket.groupBy({ by: ["statusId"], where: { AND: [scope, { deletedAt: null }] }, _count: true }),
      db.ticket.groupBy({ by: ["priorityId"], where: { AND: [scope, openCat] }, _count: true }),
      db.status.findMany({ orderBy: { order: "asc" } }),
      db.priority.findMany({ orderBy: { order: "desc" } }),
      db.priority.findMany(),
      db.ticket.findMany({
        where: { AND: [scope, { deletedAt: null }] },
        include: {
          project: { select: { key: true } }, status: true, priority: true, type: true,
          assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      db.ticket.findMany({
        where: { AND: [scope, { deletedAt: null }, { status: { category: "DONE" } }, { updatedAt: { gte: new Date(Date.now() - 90 * DAY) } }] },
        select: { createdAt: true, updatedAt: true },
        take: 500,
      }),
      db.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS count FROM "Ticket"
        WHERE "deletedAt" IS NULL AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', t."updatedAt") AS day, count(*) AS count FROM "Ticket" t
        JOIN "Status" s ON s.id = t."statusId"
        WHERE t."deletedAt" IS NULL AND s.category = 'DONE' AND t."updatedAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      teamUserIds.length && teamProjectIds.length
        ? db.ticket.groupBy({
            by: ["assigneeId"],
            where: { AND: [{ assigneeId: { in: teamUserIds } }, { projectId: { in: teamProjectIds } }, openCat] },
            _count: true,
          })
        : Promise.resolve([]),
      teamUserIds.length && teamProjectIds.length
        ? db.ticket.groupBy({
            by: ["assigneeId"],
            where: { AND: [{ assigneeId: { in: teamUserIds } }, { projectId: { in: teamProjectIds } }, { deletedAt: null }, { status: { category: "DONE" } }] },
            _count: true,
          })
        : Promise.resolve([]),
      teamUserIds.length && teamProjectIds.length
        ? db.ticket.groupBy({
            by: ["assigneeId"],
            where: { AND: [{ assigneeId: { in: teamUserIds } }, { projectId: { in: teamProjectIds } }, openCat, { dueDate: { lt: startOfToday } }] },
            _count: true,
          })
        : Promise.resolve([]),
    ]);

    const highPriorityIds = prioritiesAll.filter((p) => p.order >= 3).map((p) => p.id);
    const highPriority = highPriorityIds.length
      ? await db.ticket.count({ where: { AND: [scope, openCat, { priorityId: { in: highPriorityIds } }] } })
      : 0;

    // Workload computed in memory from 3 group-by queries instead of 3 queries per member
    const openMap = new Map(openByAssignee.map((r) => [r.assigneeId!, r._count]));
    const doneMap = new Map(doneByAssignee.map((r) => [r.assigneeId!, r._count]));
    const overdueMap = new Map(overdueByAssignee.map((r) => [r.assigneeId!, r._count]));
    const workload = teamUsers
      .map((m) => ({
        id: m.id,
        name: `${m.firstName} ${m.lastName}`,
        avatarUrl: m.avatarUrl,
        open: openMap.get(m.id) ?? 0,
        done: doneMap.get(m.id) ?? 0,
        overdue: overdueMap.get(m.id) ?? 0,
      }))
      .sort((a, b) => b.open - a.open);

    const trend: { day: string; created: number; completed: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const key = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10);
      const c = createdRows.find((r) => new Date(r.day).toISOString().slice(0, 10) === key);
      const f = completedRows.find((r) => new Date(r.day).toISOString().slice(0, 10) === key);
      trend.push({ day: key, created: Number(c?.count ?? 0), completed: Number(f?.count ?? 0) });
    }

    const avgResolutionDays = doneRecent.length
      ? doneRecent.reduce((a, t) => a + (t.updatedAt.getTime() - t.createdAt.getTime()) / DAY, 0) / doneRecent.length
      : null;

    return {
      view: "manager" as const,
      cards: { totalOpen, unassigned, completed, overdue, highPriority, dueToday, assignedToMe },
      byStatus: byStatusRaw.map((s) => ({ name: statuses.find((x) => x.id === s.statusId)?.name ?? "?", color: statuses.find((x) => x.id === s.statusId)?.color ?? "#64748b", count: s._count })),
      byPriority: byPriorityRaw.map((p) => ({ name: priorities.find((x) => x.id === p.priorityId)?.name ?? "?", color: priorities.find((x) => x.id === p.priorityId)?.color ?? "#64748b", count: p._count })),
      workload,
      trend,
      avgResolutionDays: avgResolutionDays !== null ? Number(avgResolutionDays.toFixed(1)) : null,
      recent: recent.map((t) => ({
        key: t.key, title: t.title, status: t.status.name, statusColor: t.status.color,
        priority: t.priority.name, priorityColor: t.priority.color, typeIcon: t.type.icon, typeName: t.type.name,
        projectKey: t.project.key, assignee: t.assignee, updatedAt: t.updatedAt,
      })),
    };
  }

  // ---- Employee dashboard ----
  const prioritiesAll = await db.priority.findMany();
  const highPriorityIds = prioritiesAll.filter((p) => p.order >= 3).map((p) => p.id);

  const [myOpen, myOverdue, myDueToday, myCompleted, availableWork, recentlyAssigned, recentlyUpdated, myHighPriority] = await Promise.all([
    db.ticket.count({ where: { AND: [mine, openCat] } }),
    db.ticket.count({ where: { AND: [mine, openCat, { dueDate: { lt: startOfToday } }] } }),
    db.ticket.count({ where: { AND: [mine, openCat, { dueDate: { gte: startOfToday, lt: endOfToday } }] } }),
    db.ticket.count({ where: { AND: [mine, { deletedAt: null }, { status: { category: "DONE" } }] } }),
    db.ticket.count({ where: { AND: [{ assigneeId: null }, openCat, { project: { teamId: user.teamId ?? "__none__" } }] } }),
    db.ticket.findMany({
      where: { AND: [mine, openCat] },
      include: { project: { select: { key: true } }, status: true, priority: true, type: true },
      orderBy: { createdAt: "desc" }, take: 5,
    }),
    db.ticket.findMany({
      where: { AND: [{ OR: [{ assigneeId: user.id }, { reporterId: user.id }, { watchers: { some: { userId: user.id } } }] }, { deletedAt: null }] },
      include: { project: { select: { key: true } }, status: true, priority: true, type: true },
      orderBy: { updatedAt: "desc" }, take: 5,
    }),
    highPriorityIds.length ? db.ticket.count({ where: { AND: [mine, openCat, { priorityId: { in: highPriorityIds } }] } }) : Promise.resolve(0),
  ]);

  return {
    view: "employee" as const,
    cards: { myOpen, myOverdue, myDueToday, myHighPriority, myCompleted, availableWork },
    recentlyAssigned: recentlyAssigned.map((t) => ({ key: t.key, title: t.title, status: t.status.name, statusColor: t.status.color, priority: t.priority.name, priorityColor: t.priority.color, typeIcon: t.type.icon, typeName: t.type.name, projectKey: t.project.key, createdAt: t.createdAt })),
    recentlyUpdated: recentlyUpdated.map((t) => ({ key: t.key, title: t.title, status: t.status.name, statusColor: t.status.color, priority: t.priority.name, priorityColor: t.priority.color, typeIcon: t.type.icon, typeName: t.type.name, projectKey: t.project.key, updatedAt: t.updatedAt })),
  };
}

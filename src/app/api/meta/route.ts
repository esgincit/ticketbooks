import { db } from "@/lib/db";
import { authRoute, ok } from "@/lib/api";
import { remember } from "@/lib/cache";
import { withDbRetry } from "@/lib/db-retry";

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];

/** Aggregated reference data for form pickers. Identical for everyone -> 60s cache. */
export const GET = authRoute(async () => {
  const payload = await remember("meta", 60_000, () => withDbRetry(async () => {
    const [statuses, priorities, types, projects, labels, sprints, teams, allUsers] = await Promise.all([
      db.status.findMany({ orderBy: { order: "asc" } }),
      db.priority.findMany({ orderBy: { order: "desc" } }),
      db.ticketType.findMany({ orderBy: { order: "asc" } }),
      db.project.findMany({ where: { archived: false }, select: { id: true, key: true, name: true, teamId: true }, orderBy: { key: "asc" } }),
      db.label.findMany({ select: { id: true, name: true, color: true, projectId: true, project: { select: { key: true } } }, orderBy: { name: "asc" } }),
      db.sprint.findMany({ where: { state: { in: ["PLANNED", "ACTIVE"] } }, include: { project: { select: { key: true } } }, orderBy: { createdAt: "desc" } }),
      db.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.user.findMany({
        where: { status: { not: "DISABLED" } },
        select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, teamId: true },
        orderBy: { firstName: "asc" },
      }),
    ]);
    return { statuses, priorities, types, projects, users: allUsers, labels, sprints, teams };
  }));
  return ok(payload);
});

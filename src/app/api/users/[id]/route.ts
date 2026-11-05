import { z } from "zod";
import { db } from "@/lib/db";
import { authRoute, parseBody, ok } from "@/lib/api";
import { forbidden, notFound, badRequest } from "@/lib/errors";
import { can } from "@/lib/rbac";
import { hashPassword, randomToken } from "@/lib/auth/password";
import { revokeUserCredentials } from "@/lib/auth/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authRoute(async (_req, user, ctx: Ctx) => {
  if (!can(user, "user.manage") && !can(user, "user.view") && !can(user, "*")) throw forbidden();
  const { id } = await ctx.params;
  const u = await db.user.findUnique({
    where: { id },
    include: { role: true, team: { include: { manager: true } } },
  });
  if (!u) throw notFound("User not found");

  const [assignedOpen, assignedDone, overdue] = await Promise.all([
    db.ticket.count({ where: { assigneeId: id, deletedAt: null, status: { category: { not: "DONE" } } } }),
    db.ticket.count({ where: { assigneeId: id, deletedAt: null, status: { category: "DONE" } } }),
    db.ticket.count({ where: { assigneeId: id, deletedAt: null, dueDate: { lt: new Date() }, status: { category: { not: "DONE" } } } }),
  ]);
  // average resolution time computed separately (days between createdAt and updatedAt for done)
  const doneTickets = await db.ticket.findMany({
    where: { assigneeId: id, deletedAt: null, status: { category: "DONE" } },
    select: { createdAt: true, updatedAt: true },
    take: 200,
  });
  const resolutionDays =
    doneTickets.length > 0
      ? doneTickets.reduce((acc, t) => acc + (t.updatedAt.getTime() - t.createdAt.getTime()) / 86400000, 0) / doneTickets.length
      : null;

  return ok({
    user: {
      id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email,
      jobTitle: u.jobTitle, phone: u.phone, timeZone: u.timeZone, avatarUrl: u.avatarUrl,
      status: u.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
      role: { id: u.roleId, name: u.role.name },
      team: u.team ? { id: u.team.id, name: u.team.name, managerName: u.team.manager ? `${u.team.manager.firstName} ${u.team.manager.lastName}` : null } : null,
    },
    stats: { assignedOpen, assignedDone, overdue, avgResolutionDays: resolutionDays !== null ? Number(resolutionDays.toFixed(1)) : null },
  });
});

const patchSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  jobTitle: z.string().max(100).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  timeZone: z.string().max(60).nullable().optional(),
  roleId: z.string().optional(),
  teamId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INVITED", "DISABLED"]).optional(),
  resetPassword: z.boolean().optional(),
});

export const PATCH = authRoute(async (req, actor, ctx: Ctx) => {
  if (!can(actor, "user.manage") && !can(actor, "*")) throw forbidden();
  const { id } = await ctx.params;
  const data = await parseBody(req, patchSchema);

  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw notFound("User not found");

  let newPassword: string | undefined;
  if (data.resetPassword) {
    newPassword = `St-${randomToken(9)}!`;
  }
  const passwordHash = newPassword ? await hashPassword(newPassword) : undefined;
  // Re-enabling a user or handing back a new password must not revive old access
  const [updated] = await db.$transaction([
    db.user.update({
      where: { id },
      data: {
        firstName: data.firstName, lastName: data.lastName,
        jobTitle: data.jobTitle, phone: data.phone, timeZone: data.timeZone,
        roleId: data.roleId, teamId: data.teamId, status: data.status,
        passwordHash,
      },
    }),
    ...(newPassword || data.status === "DISABLED" ? revokeUserCredentials(id, target.email) : []),
  ]);
  await db.auditLog.create({
    data: { userId: actor.id, action: data.status === "DISABLED" ? "USER_DISABLED" : "USER_UPDATED", entityType: "User", entityId: id, metadata: { fields: Object.keys(data) } },
  });
  return ok({ id: updated.id, tempPassword: newPassword });
});

export const DELETE = authRoute(async (_req, actor, ctx: Ctx) => {
  if (!can(actor, "user.manage") && !can(actor, "*")) throw forbidden();
  const { id } = await ctx.params;
  if (id === actor.id) throw badRequest("You cannot delete your own account");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw notFound("User not found");

  // Historical integrity: FKs are SetNull so ticket history survives deletion.
  await db.$transaction([
    db.session.deleteMany({ where: { userId: id } }),
    db.passwordResetToken.deleteMany({ where: { userId: id } }),
    db.ticketWatcher.deleteMany({ where: { userId: id } }),
    db.notification.deleteMany({ where: { userId: id } }),
    db.user.delete({ where: { id } }),
  ]);
  await db.auditLog.create({ data: { userId: actor.id, action: "USER_DELETED", entityType: "User", entityId: id, metadata: { email: target.email } } });
  return ok({ success: true });
});

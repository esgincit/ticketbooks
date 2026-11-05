import { z } from "zod";
import { db } from "@/lib/db";
import { publicRoute, parseBody, ok } from "@/lib/api";
import { unauthorized, badRequest } from "@/lib/errors";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/auth/password";

/** Change own password (requires current password) */
export const POST = publicRoute(async (req) => {
  const { createSession, getSessionUser, revokeUserCredentials } = await import("@/lib/auth/session");
  const me = await getSessionUser();
  if (!me) throw unauthorized();

  const body = await parseBody(req, z.object({ currentPassword: z.string(), newPassword: z.string().min(8, "New password must be at least 8 characters") }));
  const user = await db.user.findUnique({ where: { id: me.id } });
  if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest("Current password is incorrect");

  await db.$transaction([
    db.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(body.newPassword) } }),
    ...revokeUserCredentials(me.id),
  ]);
  await createSession(me.id); // signed out everywhere else, but this browser stays signed in
  await db.auditLog.create({ data: { userId: me.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: me.id } });
  return ok({ success: true });
});

import { z } from "zod";
import { db } from "@/lib/db";
import { publicRoute, parseBody, ok } from "@/lib/api";
import { hashPassword, sha256 } from "@/lib/auth/password";
import { revokeUserCredentials } from "@/lib/auth/session";
import { audit } from "@/lib/history";

const schema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const POST = publicRoute(
  async (req) => {
    const body = await parseBody(req, schema);
    const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(body.token) } });

    if (!row || row.usedAt || row.expiresAt < new Date()) {
      return ok({ success: false, reason: "This reset link is invalid or has expired. Please request a new one." });
    }
    // A reset activates invited users, but must never re-enable a disabled account
    const user = await db.user.findUnique({ where: { id: row.userId }, select: { status: true } });
    if (!user || user.status === "DISABLED") {
      return ok({ success: false, reason: "Account is disabled." });
    }

    await db.$transaction([
      db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(body.newPassword), status: "ACTIVE", emailVerifiedAt: new Date() } }),
      db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      ...revokeUserCredentials(row.userId),
    ]);
    await audit({ userId: row.userId, action: "PASSWORD_RESET", entityType: "User", entityId: row.userId, ip: req.headers.get("x-forwarded-for") ?? undefined });

    return ok({ success: true });
  },
  { n: 10, ms: 60_000 }
);

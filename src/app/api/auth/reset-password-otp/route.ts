import { z } from "zod";
import { db } from "@/lib/db";
import { publicRoute, parseBody, ok } from "@/lib/api";
import { hashPassword, sha256 } from "@/lib/auth/password";
import { hashOtp } from "@/lib/auth/otp";
import { revokeUserCredentials } from "@/lib/auth/session";

const schema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const POST = publicRoute(
  async (req) => {
    const { email: rawEmail, otp, newPassword } = await parseBody(req, schema);
    const email = rawEmail.toLowerCase().trim();
    const otpHash = hashOtp(otp.trim());

    const token = await db.otpToken.findFirst({
      where: { email, purpose: "password_reset", verifiedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!token) {
      return ok({ success: false, reason: "No reset code found. Please request a new one." }, { status: 400 });
    }
    if (token.expiresAt < new Date()) {
      return ok({ success: false, reason: "This code has expired. Please request a new one." }, { status: 400 });
    }
    if (token.otpHash !== otpHash) {
      await db.otpToken.update({ where: { id: token.id }, data: { attempts: token.attempts + 1 } });
      return ok({ success: false, reason: "Incorrect code." }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return ok({ success: false, reason: "No account found for this email." }, { status: 404 });
    }
    if (user.status === "DISABLED") {
      return ok({ success: false, reason: "Account is disabled." }, { status: 400 });
    }

    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), status: "ACTIVE", emailVerifiedAt: new Date() } }),
      db.otpToken.update({ where: { id: token.id }, data: { verifiedAt: new Date() } }),
      ...revokeUserCredentials(user.id),
      // Also invalidate any old password reset tokens
      db.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    ]);

    await db.auditLog.create({ data: { userId: user.id, action: "PASSWORD_RESET_OTP", entityType: "User", entityId: user.id, ip: req.headers.get("x-forwarded-for") ?? undefined } });

    return ok({ success: true });
  },
  { n: 10, ms: 60_000 }
);

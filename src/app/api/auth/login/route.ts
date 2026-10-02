import { z } from "zod"

import { db } from "@/lib/db"

import { publicRoute, parseBody, ok } from "@/lib/api"

import { badRequest, unauthorized } from "@/lib/errors"

import { verifyPassword } from "@/lib/auth/password"

import { createSession } from "@/lib/auth/session"

import { audit } from "@/lib/history"

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];


export const POST = publicRoute(
  async (req) => {
    const body = await parseBody(req, z.object({ email: z.string().email(), password: z.string().min(1) }))

    const ip = req.headers.get("x-forwarded-for") ?? "local"


    const user = await db.user.findUnique({ where: { email: body.email.toLowerCase().trim() }, include: { role: true } })

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      await audit({ action: "LOGIN_FAILED", entityType: "Session", entityId: null, ip, metadata: { email: body.email } })

      throw unauthorized("Incorrect email or password")

    }
    if (user.status === "DISABLED") {
      throw unauthorized("This account has been disabled. Contact your administrator.")

    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined })

    await audit({ userId: user.id, action: "LOGIN", entityType: "Session", ip })


    return ok({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roleName: user.role.name,
    })

  },
  { n: 10, ms: 60_000 }
)


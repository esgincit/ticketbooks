import { z } from "zod"

import { db } from "@/lib/db"

import { authRoute, parseBody, ok } from "@/lib/api"

import { unreadCount } from "@/lib/notify"

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];


export const GET = authRoute(async (_req, user) => {
  const unread = await unreadCount(user.id)

  return ok({ user, unreadNotifications: unread })

})


const profileSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  jobTitle: z.string().max(100).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  timeZone: z.string().max(60).nullable().optional(),
  prefs: z.record(z.unknown()).optional(),
})


export const PATCH = authRoute(async (req, sessionUser) => {
  const data = await parseBody(req, profileSchema)

  const updated = await db.user.update({ where: { id: sessionUser.id }, data: { ...data, prefs: data.prefs ? (data.prefs as object) : undefined } })

  return ok({ firstName: updated.firstName, lastName: updated.lastName, jobTitle: updated.jobTitle, phone: updated.phone, timeZone: updated.timeZone })

})


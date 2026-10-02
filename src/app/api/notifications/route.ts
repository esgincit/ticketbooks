import { z } from "zod"

import { db } from "@/lib/db"

import { authRoute, parseBody, ok } from "@/lib/api"

import { unreadCount } from "@/lib/notify"

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];


export const GET = authRoute(async (req, user) => {
  const url = new URL(req.url)

  const onlyUnread = url.searchParams.get("unread") === "true"

  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1))

  const pageSize = 25


  const [items, total, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id, ...(onlyUnread ? { readAt: null } : {}) },
      include: {
        actor: { select: { firstName: true, lastName: true, avatarUrl: true } },
        ticket: { select: { key: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.notification.count({ where: { userId: user.id, ...(onlyUnread ? { readAt: null } : {}) } }),
    unreadCount(user.id),
  ])

  return ok({ items, total, page, unread })

})


export const POST = authRoute(async (req, user) => {
  const body = await parseBody(req, z.object({ action: z.literal("markAllRead") }))

  void body

  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } })

  return ok({ success: true, unread: await unreadCount(user.id) })

})


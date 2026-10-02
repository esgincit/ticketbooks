import { db } from "@/lib/db"

import { authRoute, ok } from "@/lib/api"

import { ticketScopeFor } from "@/lib/rbac"

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];


/** Global search used by the command palette (Ctrl+K) and quick search */
export const GET = authRoute(async (req, user) => {
  const url = new URL(req.url)

  const q = (url.searchParams.get("q") ?? "").trim()

  if (!q) return ok({ tickets: [], total: 0 })


  const isKeyLike = /^[A-Za-z]+-\d+$/.test(q)

  const where = {
    AND: [
      { deletedAt: null },
      ticketScopeFor(user),
      isKeyLike
        ? { key: q.toUpperCase() }
        : { OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ] },
    ],
  }


  const tickets = await db.ticket.findMany({
    where,
    include: {
      project: { select: { key: true, name: true } },
      status: true, priority: true, type: true,
      assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: isKeyLike ? 1 : 15,
  })


  return ok({
    total: tickets.length,
    tickets: tickets.map((t) => ({
      id: t.id, key: t.key, title: t.title,
      projectKey: t.project.key, projectName: t.project.name,
      typeIcon: t.type.icon, typeName: t.type.name,
      statusName: t.status.name, statusColor: t.status.color,
      priorityName: t.priority.name, priorityColor: t.priority.color,
      assignee: t.assignee,
    })),
  })

})


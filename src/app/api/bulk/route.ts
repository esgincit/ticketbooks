import { z } from "zod";
import { db } from "@/lib/db";
import { authRoute, parseBody, ok } from "@/lib/api";

const schema = z.object({
  keys: z.array(z.string()).min(1).max(100),
  action: z.enum(["assign", "status", "priority", "label", "delete", "project"]),
  value: z.string().nullable(),
});

/** Bulk operations for managers */
export const PATCH = authRoute(async (req, actor) => {
  const data = await parseBody(req, schema);
  const results = { updated: 0, failed: [] as { key: string; error: string }[] };

  for (const key of data.keys) {
    try {
      let ticket = await db.ticket.findFirst({ where: { key: key.toUpperCase(), deletedAt: null } });
      if (!ticket) ticket = await db.ticket.findFirst({ where: { id: key, deletedAt: null } });
      if (!ticket) throw new Error("Ticket not found");

      // Every action goes through the service layer so the same permission
      // checks apply as for single-ticket edits (ticket.delete.team, ticket.assign, edit rights)
      const { updateTicket, assignTicket, archiveTicket } = await import("@/lib/tickets/service");
      if (data.action === "delete") {
        await archiveTicket(actor, ticket.key);
      } else if (data.action === "assign") {
        await assignTicket(actor, ticket.key, data.value || null);
      } else if (data.action === "label") {
        if (!data.value) throw new Error("Label required");
        const current = await db.ticketLabel.findMany({ where: { ticketId: ticket.id }, select: { labelId: true } });
        const labelIds = [...new Set([...current.map((l) => l.labelId), data.value])];
        await updateTicket(actor, ticket.key, { labelIds });
      } else if (data.action === "project") {
        // Moving changes the ticket key/numbering; not supported (previously a silent no-op)
        throw new Error("Moving tickets between projects is not supported");
      } else {
        if (!data.value) throw new Error("Value required");
        await updateTicket(actor, ticket.key, data.action === "status" ? { statusId: data.value } : { priorityId: data.value });
      }
      results.updated += 1;
    } catch (e) {
      results.failed.push({ key, error: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  await db.auditLog.create({ data: { userId: actor.id, action: "BULK_UPDATE", entityType: "Ticket", metadata: { keys: data.keys.length, action: data.action, updated: results.updated } } });
  return ok(results);
});

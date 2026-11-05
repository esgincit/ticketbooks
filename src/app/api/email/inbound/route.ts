import { z } from "zod";
import { db } from "@/lib/db";
import { publicRoute, parseBody, ok } from "@/lib/api";
import { unauthorized, badRequest } from "@/lib/errors";

/**
 * Inbound email -> ticket gateway (§22).
 * Point your mail provider's webhook/inbound-parse (SendGrid Inbound Parse,
 * AWS SES receipt rule -> HTTPS, Mailgun routes, or a small SMTP poller)
 * at POST /api/email/inbound with header `x-strike-inbound-secret`.
 *
 * - New subject  -> creates a ticket in the configured support project
 * - "[KEY-1234]" in subject -> adds an inbound comment to that ticket
 */
const schema = z.object({
  from: z.string().email(),
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  textBody: z.string().max(100000).optional(),
  htmlBody: z.string().max(200000).optional(),
});

export const POST = publicRoute(async (req) => {
  const secret = req.headers.get("x-strike-inbound-secret");
  if (!process.env.INBOUND_EMAIL_SECRET || secret !== process.env.INBOUND_EMAIL_SECRET) {
    throw unauthorized("Invalid inbound secret");
  }

  const data = await parseBody(req, schema);

  // Ignore auto-replies
  if (/^(auto:|out of office|undeliverable)/i.test(data.subject)) return ok({ ignored: true });

  const keyMatch = data.subject.match(/\[([A-Z][A-Z0-9]{1,9}-\d+)\]/i);
  const emailEvent = await db.emailEvent.create({
    data: {
      direction: "INBOUND",
      sender: data.from,
      recipients: data.to,
      subject: data.subject,
      body: data.htmlBody ?? data.textBody ?? "",
      status: "RECEIVED",
    },
  });

  if (keyMatch) {
    const ticket = await db.ticket.findFirst({ where: { key: keyMatch[1].toUpperCase(), deletedAt: null } });
    if (ticket) {
      // Security: only accept replies from known users; otherwise store as email event only
      const user = await db.user.findUnique({ where: { email: data.from.toLowerCase() }, include: { role: true } });
      if (user && user.status !== "DISABLED") {
        const { addComment } = await import("@/lib/tickets/service");
        const rolePermissions = Array.isArray(user.role.permissions) ? (user.role.permissions as string[]) : [];
        await addComment(
          // Real team and role, so the ticket access check treats this reply like one made in the app
          { id: user.id, firstName: user.firstName, lastName: user.lastName, teamId: user.teamId, permissions: [...rolePermissions, "ticket.comment"] } as never,
          ticket.key,
          `<p>${(data.textBody ?? "See attached HTML").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`
        );
        void emailEvent;
        return ok({ action: "comment", ticketKey: ticket.key });
      }
    }
    throw badRequest("Referenced ticket not found");
  }

  // Create new ticket from email into the support project
  const setting = await db.setting.findUnique({ where: { key: "organization" } });
  const supportProjectKey = ((setting?.value as { supportProjectKey?: string }) ?? {}).supportProjectKey;
  const project = supportProjectKey
    ? await db.project.findUnique({ where: { key: supportProjectKey.toUpperCase() } })
    : await db.project.findFirst({ where: { archived: false }, orderBy: { createdAt: "asc" } });
  if (!project) throw badRequest("No inbound project configured");

  const defaultStatus = await db.status.findFirst({ where: { isDefault: true } });
  const defaultPriority = await db.priority.findFirst({ where: { name: "Medium" } }) ?? (await db.priority.findFirst({ where: { isDefault: true } }));
  const supportType = await db.ticketType.findFirst({ where: { name: "Support" } }) ?? (await db.ticketType.findFirst());

  // Atomic single-statement numbering (pooler-safe, no interactive transaction)
  const rows = await db.$queryRaw<{ num: number }[]>`
    UPDATE "Project" SET "nextNumber" = "nextNumber" + 1
    WHERE id = ${project.id}
    RETURNING "nextNumber" AS num`;
  const nextNumber = Number(rows[0].num);
  const created = await db.ticket.create({
    data: {
      key: `${project.key}-${nextNumber}`,
      number: nextNumber,
      projectId: project.id,
      typeId: supportType!.id,
      statusId: defaultStatus!.id,
      priorityId: defaultPriority!.id,
      title: `Email from ${data.from}: ${data.subject}`.slice(0, 280),
      description: `<p>${(data.textBody ?? data.htmlBody ?? "").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`,
    },
  });

  await db.emailEvent.update({ where: { id: emailEvent.id }, data: { ticketId: created.id } });
  await db.$transaction(async (tx) => {
    await tx.ticketHistory.create({ data: { ticketId: created.id, field: "created", newValue: "email", message: `Created from inbound email by ${data.from}` } });
  });

  return ok({ action: "created", ticketKey: created.key });
});

import { db } from "@/lib/db";
import { authRoute, ok } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { readObject } from "@/lib/storage";
import { canViewTicket } from "@/lib/tickets/service";

type Ctx = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Authorized attachment download: only users who can see the parent ticket */
export const GET = authRoute(async (_req, user, ctx: Ctx) => {
  const { id } = await ctx.params;
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a || !a.ticketId) throw notFound("Attachment not found");
  // Same rule as opening the ticket; 404 so it doesn't confirm the attachment exists
  if (!(await canViewTicket(user, a.ticketId))) throw notFound("Attachment not found");

  try {
    const data = await readObject(a.storagePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": a.mimeType,
        "Content-Length": String(a.size),
        "Content-Disposition": `attachment; filename="${a.fileName.replace(/["\\]/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    throw notFound("File data is missing from storage");
  }
});

import { randomUUID } from "crypto";
import path from "path";
import { db } from "@/lib/db";
import { authRoute, ok } from "@/lib/api";
import { badRequest, notFound } from "@/lib/errors";
import { saveObject } from "@/lib/storage";
import { assertCanViewTicket } from "@/lib/tickets/service";

type Ctx = { params: Promise<{ key: string }> };

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".zip"]);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB ?? 20);

export const runtime = "nodejs";
// Serverless platforms cap request bodies (~4.5MB on Vercel); smaller of the two limits applies
export const maxDuration = 60;

export const POST = authRoute(async (req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  const ticket = await db.ticket.findFirst({ where: { key: key.toUpperCase(), deletedAt: null } });
  if (!ticket) throw notFound("Ticket not found");
  await assertCanViewTicket(user, ticket.id);

  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Expected multipart form data");
  const file = form.get("file");
  const commentId = form.get("commentId");
  if (!(file instanceof File)) throw badRequest("No file provided");
  if (file.size > MAX_MB * 1024 * 1024) throw badRequest(`File exceeds the ${MAX_MB}MB limit`);

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw badRequest(`File type ${ext || "(unknown)"} is not allowed`);
  if (file.name.includes("/") || file.name.includes("\\")) throw badRequest("Invalid file name");

  // Random storage name: no user input ever touches a filesystem/storage path
  const storageName = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await saveObject(storageName, buffer);

  const attachment = await db.attachment.create({
    data: {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storagePath: storageName,
      uploaderId: user.id,
      ticketId: ticket.id,
      commentId: typeof commentId === "string" && commentId ? commentId : null,
    },
  });
  await db.$transaction(async (tx) => {
    await tx.ticketHistory.create({ data: { ticketId: ticket.id, userId: user.id, field: "attachment", newValue: file.name, message: "Attachment added" } });
    await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
  });
  return ok(attachment, { status: 201 });
});

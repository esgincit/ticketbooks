import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { authRoute, parseBody, ok } from "@/lib/api";
import { audit } from "@/lib/history";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { can } from "@/lib/rbac";
import { randomToken, sha256 } from "@/lib/auth/password";

/** Tokens are managed from the signed-in web app only: an AI tool's token can't mint a longer-lived one */
async function assertBrowserSession() {
  if ((await headers()).get("authorization")) throw forbidden("CI tokens can only be managed from the web app");
}

export const GET = authRoute(async (_req, user) => {
  await assertBrowserSession();
  const tokens = await db.ciToken.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, name: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return ok({ tokens });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

export const POST = authRoute(async (req, user) => {
  await assertBrowserSession();
  if (!can(user, "testcase.execute")) throw forbidden();
  const data = await parseBody(req, createSchema);
  const token = `strike_ci_${randomToken()}`;
  const created = await db.ciToken.create({
    data: { name: data.name, tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + data.expiresInDays * 86400000) },
    select: { id: true, name: true, expiresAt: true },
  });
  await audit({ userId: user.id, action: "CI_TOKEN_CREATED", entityType: "CiToken", entityId: created.id, metadata: { name: created.name } });
  return ok({ ...created, token }, { status: 201 }); // shown once; only the hash is stored
});

export const DELETE = authRoute(async (req, user) => {
  await assertBrowserSession();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw badRequest("id is required");
  const { count } = await db.ciToken.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count === 0) throw notFound("Token not found");
  await audit({ userId: user.id, action: "CI_TOKEN_REVOKED", entityType: "CiToken", entityId: id });
  return ok({ success: true });
});

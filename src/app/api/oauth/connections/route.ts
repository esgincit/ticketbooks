import { db } from "@/lib/db";
import { authRoute, ok } from "@/lib/api";
import { badRequest } from "@/lib/errors";

/** AI tools the current user has connected (OAuth/MCP) */
export const GET = authRoute(async (_req, user) => {
  const tokens = await db.mcpToken.findMany({
    where: { userId: user.id, kind: "refresh", revokedAt: null, expiresAt: { gt: new Date() } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const byClient = new Map<string, { clientId: string; name: string; connectedAt: Date }>();
  for (const t of tokens) {
    if (!byClient.has(t.clientId)) byClient.set(t.clientId, { clientId: t.clientId, name: t.client.name, connectedAt: t.createdAt });
  }
  return ok({ connections: [...byClient.values()] });
});

/** Disconnect an AI tool: revokes all of this user's tokens for it */
export const DELETE = authRoute(async (req, user) => {
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) throw badRequest("clientId is required");
  const { count } = await db.mcpToken.updateMany({ where: { userId: user.id, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
  await db.auditLog.create({ data: { userId: user.id, action: "AI_TOOL_DISCONNECTED", entityType: "McpClient", entityId: clientId } });
  return ok({ success: true, revoked: count });
});

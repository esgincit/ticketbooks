import crypto from "crypto";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "./password";

/**
 * Minimal OAuth 2.1 authorization server for the MCP endpoint.
 * Public clients only (PKCE S256, no client secret) - this is what Claude Code
 * and other MCP clients use. Tokens are stored hashed, like sessions.
 */
export const CODE_TTL_MS = 10 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 86400_000;

export function originOf(req: Request): string {
  return new URL(req.url).origin;
}

/**
 * Redirect URIs: http on loopback (native/CLI clients such as Claude Code, RFC 8252),
 * or https only on hosts an admin listed in MCP_ALLOWED_REDIRECT_HOSTS (e.g. "claude.ai").
 * Open https registration would let anyone phish a consent and receive the user's code.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") {
      const hosts = (process.env.MCP_ALLOWED_REDIRECT_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
      return hosts.includes(u.hostname.toLowerCase());
    }
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createCode(userId: string, clientId: string, codeChallenge: string, redirectUri: string) {
  const code = randomToken();
  await db.mcpToken.create({
    data: { tokenHash: sha256(code), kind: "code", userId, clientId, codeChallenge, redirectUri, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

export async function issueTokens(userId: string, clientId: string) {
  const access = randomToken();
  const refresh = randomToken();
  const now = Date.now();
  await db.mcpToken.createMany({
    data: [
      { tokenHash: sha256(access), kind: "access", userId, clientId, expiresAt: new Date(now + ACCESS_TTL_MS) },
      { tokenHash: sha256(refresh), kind: "refresh", userId, clientId, expiresAt: new Date(now + REFRESH_TTL_MS) },
    ],
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
  };
}

/** Consumes a single-use code/refresh token; returns it if it was valid */
export async function consumeToken(raw: string, kind: "code" | "refresh", clientId: string) {
  const t = await db.mcpToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!t || t.kind !== kind || t.clientId !== clientId || t.revokedAt || t.expiresAt < new Date()) return null;
  // Conditional update = atomic single use (a replayed code loses the race)
  const { count } = await db.mcpToken.updateMany({ where: { id: t.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return count === 1 ? t : null;
}

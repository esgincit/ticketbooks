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

const CHATGPT_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

/**
 * Name of the known web connector behind this exact return address, if any. Exact URL, not a host:
 * nothing else on chatgpt.com qualifies. MCP_DISABLE_CHATGPT="true" turns it off, and takes effect
 * for new sign-ins because authorize re-checks; connected users are removed with disconnect_ai_tool.
 */
export function knownConnectorName(uri: string): string | null {
  return uri === CHATGPT_REDIRECT_URI && process.env.MCP_DISABLE_CHATGPT !== "true" ? "ChatGPT" : null;
}

const isLoopback = (u: URL) => u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);

/**
 * Redirect URIs: http on loopback (native/CLI clients such as Claude Code, RFC 8252),
 * a known connector's exact address, or https on hosts an admin listed in
 * MCP_ALLOWED_REDIRECT_HOSTS (e.g. "claude.ai").
 * Open https registration would let anyone phish a consent and receive the user's code.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (knownConnectorName(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") {
      const hosts = (process.env.MCP_ALLOWED_REDIRECT_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
      return hosts.includes(u.hostname.toLowerCase());
    }
    return isLoopback(u);
  } catch {
    return false;
  }
}

/**
 * The address to send the user back to, or null if the client didn't register this redirect_uri.
 * Must match exactly, except that local apps pick a free port on each run, so loopback may use
 * any port (RFC 8252 section 7.3).
 *
 * "localhost" can also mean a registered 127.0.0.1 or [::1]: NextRequest.url replaces the first such
 * address anywhere in the URL, query string included, so on a real domain http://127.0.0.1:port/ reaches
 * us as http://localhost:port/ (next/dist/server/web/next-url.js). The registration has the real address,
 * and returning there matters because an app listening on 127.0.0.1 may not answer on localhost.
 */
export function resolveRegisteredRedirect(registered: string[], uri: string): string | null {
  if (registered.includes(uri)) return uri;
  try {
    const u = new URL(uri);
    if (!isLoopback(u)) return null;
    const samePlace = registered.map((r) => new URL(r)).filter((r) => isLoopback(r) && r.pathname === u.pathname && r.search === u.search);
    if (samePlace.some((r) => r.hostname === u.hostname)) return uri;
    const real = u.hostname === "localhost" ? samePlace[0] : undefined;
    if (!real) return null;
    u.hostname = real.hostname;
    return u.toString();
  } catch {
    return null;
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

import { cookies, headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/constants";
import { randomToken, sha256 } from "./password";
import { remember } from "@/lib/cache";

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  timeZone: string | null;
  phone: string | null;
  status: string;
  teamId: string | null;
  teamName: string | null;
  managedTeamIds: string[];
  roleId: string;
  roleName: string;
  permissions: string[];
  prefs: Record<string, unknown>;
};

const DEFAULT_SESSION_DAYS = 7;

export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = randomToken();
  const days = Number(process.env.SESSION_DAYS || DEFAULT_SESSION_DAYS);
  const expiresAt = new Date(Date.now() + days * 86400000);
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt, ip: meta?.ip, userAgent: meta?.userAgent },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.APP_URL?.startsWith("https"),
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  // AI tools (MCP / OAuth) send a Bearer token; the browser app never does.
  const bearer = await getBearerUser();
  if (bearer) return bearer;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const hash = sha256(token);
  // 5s cache: removes a DB round-trip from every request/page render
  return remember<SessionUser | null>(`sess:${hash}`, 5000, () => loadSessionUser(hash));
}

/** User behind an `Authorization: Bearer <mcp access token>` header, if valid */
export async function getBearerUser(): Promise<SessionUser | null> {
  const auth = (await headers()).get("authorization");
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const hash = sha256(token);
  return remember<SessionUser | null>(`mcp:${hash}`, 5000, () => loadMcpUser(hash));
}

/** Optional ALLOWED_EMAIL_DOMAINS="acme.com,acme.io" limits AI-tool access to company emails */
export function isCompanyEmail(email: string): boolean {
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  return domains.length === 0 || domains.includes(email.split("@")[1]?.toLowerCase() ?? "");
}

const userInclude = { role: true, team: true, managedTeams: { select: { id: true } } } as const;

async function loadMcpUser(tokenHash: string): Promise<SessionUser | null> {
  const t = await db.mcpToken.findUnique({ where: { tokenHash }, include: { user: { include: userInclude } } });
  if (!t || t.kind !== "access" || t.revokedAt || t.expiresAt < new Date()) return null;
  if (t.user.status === "DISABLED" || !isCompanyEmail(t.user.email)) return null;
  db.mcpToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return toSessionUser(t.user);
}

async function loadSessionUser(tokenHash: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: { include: userInclude } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status === "DISABLED") return null;
  return toSessionUser(session.user);
}

function toSessionUser(u: Prisma.UserGetPayload<{ include: typeof userInclude }>): SessionUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    timeZone: u.timeZone,
    phone: u.phone,
    status: u.status,
    teamId: u.teamId,
    teamName: u.team?.name ?? null,
    managedTeamIds: u.managedTeams.map((t) => t.id),
    roleId: u.roleId,
    roleName: u.role.name,
    permissions: Array.isArray(u.role.permissions) ? (u.role.permissions as string[]) : [],
    prefs: (u.prefs as Record<string, unknown>) ?? {},
  };
}

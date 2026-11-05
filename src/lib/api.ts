import { NextResponse } from "next/server";
import { ZodType, ZodTypeDef } from "zod";
import { AppError, badRequest, unauthorized } from "./errors";
import { getCiTokenUser, getSessionUser, SessionUser } from "./auth/session";
import { can } from "./rbac";

type Ctx<P> = { params: Promise<P> };

// Simple in-memory rate limiter (per process; swap for Redis in multi-node deploys)
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > limit) throw new AppError("Too many requests. Please slow down.", 429, "RATE_LIMITED");
}

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- input type differs from T when a schema uses defaults
export async function parseBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, any>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    throw badRequest(first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid request body");
  }
  return parsed.data;
}

/** Wraps a public route handler with uniform error handling + rate limiting */
export function publicRoute<Args extends unknown[] = []>(
  fn: (req: Request, ...args: Args) => Promise<Response>,
  limit = { n: 60, ms: 60_000 }
) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      rateLimit(`ip:${req.headers.get("x-forwarded-for") ?? "local"}:${new URL(req.url).pathname}`, limit.n, limit.ms);
      return await fn(req, ...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Wraps an authenticated route handler */
export function authRoute<Args extends unknown[] = []>(
  fn: (req: Request, user: SessionUser, ...args: Args) => Promise<Response>
) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      const user = await getSessionUser();
      if (!user) throw unauthorized();
      if (req) rateLimit(`u:${user.id}:${new URL(req.url).pathname}`, 300, 60_000);
      return await fn(req, user, ...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Like authRoute, but also accepts a CI token. `viaCi` tells the handler which one it got. */
export function authOrCiRoute(fn: (req: Request, user: SessionUser, viaCi: boolean) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      const session = await getSessionUser();
      const user = session ?? (await getCiTokenUser());
      if (!user) throw unauthorized();
      rateLimit(`u:${user.id}:${new URL(req.url).pathname}`, 300, 60_000);
      return await fn(req, user, !session);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Authenticated + permission-checked handler factory */
export function permRoute<P>(
  permission: string,
  fn: (req: Request, user: SessionUser, params: P) => Promise<Response>
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const user = await getSessionUser();
      if (!user) throw unauthorized();
      if (!can(user, permission)) {
        return errorResponse(new AppError("You do not have permission to perform this action.", 403, "FORBIDDEN"));
      }
      const params = ctx?.params ? await ctx.params : (undefined as unknown as P);
      rateLimit(`u:${user.id}:${new URL(req.url).pathname}`, 300, 60_000);
      return await fn(req, user, params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  console.error("[api] unhandled:", e);
  // Never leak raw DB errors
  return NextResponse.json(
    { error: "Something went wrong. Please try again.", code: "INTERNAL" },
    { status: 500 }
  );
}

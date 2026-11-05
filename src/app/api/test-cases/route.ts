import { authRoute, parseBody, ok } from "@/lib/api";
import { createCase, createCaseSchema, listCases } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];

export const GET = authRoute(async (req, user) => ok(await listCases(user, new URL(req.url).searchParams)));

export const POST = authRoute(async (req, user) => ok(await createCase(user, await parseBody(req, createCaseSchema)), { status: 201 }));

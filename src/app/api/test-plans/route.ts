import { authRoute, parseBody, ok } from "@/lib/api";
import { createPlan, createPlanSchema, listPlans } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];

export const GET = authRoute(async (req, user) => ok(await listPlans(user, new URL(req.url).searchParams)));

export const POST = authRoute(async (req, user) => ok(await createPlan(user, await parseBody(req, createPlanSchema)), { status: 201 }));

import { authRoute, parseBody, ok } from "@/lib/api";
import { deletePlan, getPlan, updatePlan, updatePlanSchema } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ key: string }> };

export const GET = authRoute(async (_req, user, ctx: Ctx) => ok(await getPlan(user, (await ctx.params).key)));

export const PATCH = authRoute(async (req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  return ok(await updatePlan(user, key, await parseBody(req, updatePlanSchema)));
});

export const DELETE = authRoute(async (_req, user, ctx: Ctx) => {
  await deletePlan(user, (await ctx.params).key);
  return ok({ success: true });
});

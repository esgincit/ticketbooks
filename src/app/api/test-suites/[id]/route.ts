import { authRoute, parseBody, ok } from "@/lib/api";
import { deleteSuite, updateSuite, updateSuiteSchema } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = authRoute(async (req, user, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await updateSuite(user, id, await parseBody(req, updateSuiteSchema)));
});

export const DELETE = authRoute(async (_req, user, ctx: Ctx) => {
  await deleteSuite(user, (await ctx.params).id);
  return ok({ success: true });
});

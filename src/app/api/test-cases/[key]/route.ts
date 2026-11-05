import { authRoute, parseBody, ok } from "@/lib/api";
import { deleteCase, getCase, updateCase, updateCaseSchema } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ key: string }> };

export const GET = authRoute(async (_req, user, ctx: Ctx) => ok(await getCase(user, (await ctx.params).key)));

export const PATCH = authRoute(async (req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  return ok(await updateCase(user, key, await parseBody(req, updateCaseSchema)));
});

export const DELETE = authRoute(async (_req, user, ctx: Ctx) => {
  await deleteCase(user, (await ctx.params).key);
  return ok({ success: true });
});

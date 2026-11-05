import { authRoute, parseBody, ok } from "@/lib/api";
import { deletePoint, updatePoint, updatePointSchema } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = authRoute(async (req, user, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await updatePoint(user, id, await parseBody(req, updatePointSchema)));
});

export const DELETE = authRoute(async (_req, user, ctx: Ctx) => {
  await deletePoint(user, (await ctx.params).id);
  return ok({ success: true });
});

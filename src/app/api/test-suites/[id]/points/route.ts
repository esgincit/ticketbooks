import { authRoute, parseBody, ok } from "@/lib/api";
import { addPoints, addPointsSchema } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ id: string }> };

export const POST = authRoute(async (req, user, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await addPoints(user, id, await parseBody(req, addPointsSchema)), { status: 201 });
});

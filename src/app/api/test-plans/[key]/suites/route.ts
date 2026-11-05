import { authRoute, parseBody, ok } from "@/lib/api";
import { createSuite, createSuiteSchema } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ key: string }> };

export const POST = authRoute(async (req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  return ok(await createSuite(user, key, await parseBody(req, createSuiteSchema)), { status: 201 });
});

import { authRoute, parseBody, ok } from "@/lib/api";
import { automationSchema, setAutomation } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ key: string }> };

export const PATCH = authRoute(async (req, user, ctx: Ctx) => {
  const { key } = await ctx.params;
  return ok(await setAutomation(user, key, await parseBody(req, automationSchema)));
});

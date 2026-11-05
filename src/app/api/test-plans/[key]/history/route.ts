import { authRoute, ok } from "@/lib/api";
import { planHistory } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
type Ctx = { params: Promise<{ key: string }> };

export const GET = authRoute(async (_req, user, ctx: Ctx) => ok(await planHistory(user, (await ctx.params).key)));

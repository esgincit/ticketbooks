import { authOrCiRoute, parseBody, ok } from "@/lib/api";
import { audit } from "@/lib/history";
import { recordResult, recordResults, resultsBodySchema } from "@/lib/testcases/service";

export const preferredRegion = ["sin1"];
export const maxDuration = 60;

/** One result, or { results: [...] } from a test run. Also accepts a CI token, and is the only route that does. */
export const POST = authOrCiRoute(async (req, user, viaCi) => {
  const body = await parseBody(req, resultsBodySchema);
  if ("results" in body) {
    // A pipeline can't report a run as manual
    const inputs = viaCi ? body.results.map((r) => ({ ...r, source: "AUTOMATED" as const })) : body.results;
    return ok(await recordResults(user, inputs, "AUTOMATED"));
  }
  const result = await recordResult(user, viaCi ? { ...body, source: "AUTOMATED" } : body, "MANUAL");
  await audit({ userId: user.id, action: "TEST_RESULT_RECORDED", entityType: "TestResult", entityId: result.id, metadata: { key: result.key, outcome: result.outcome } });
  return ok(result, { status: 201 });
});

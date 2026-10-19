import { db } from "@/lib/db";
import { publicRoute } from "@/lib/api";
import { consumeToken, issueTokens, verifyPkce } from "@/lib/auth/oauth";
import { isCompanyEmail } from "@/lib/auth/session";

const fail = (error: string, description: string) =>
  Response.json({ error, error_description: description }, { status: 400, headers: { "Cache-Control": "no-store" } });

/** OAuth token endpoint: authorization_code (+PKCE) and refresh_token (rotating) grants */
export const POST = publicRoute(
  async (req) => {
    const ct = req.headers.get("content-type") ?? "";
    const p: Record<string, string> = ct.includes("application/json")
      ? await req.json().catch(() => ({}))
      : Object.fromEntries(new URLSearchParams(await req.text()));
    const clientId = p.client_id ?? "";
    if (!clientId) return fail("invalid_client", "client_id is required");

    let userId: string;
    if (p.grant_type === "authorization_code") {
      if (!p.code || !p.code_verifier) return fail("invalid_request", "code and code_verifier are required");
      const code = await consumeToken(p.code, "code", clientId);
      if (!code || !code.codeChallenge || !verifyPkce(p.code_verifier, code.codeChallenge)) return fail("invalid_grant", "Invalid or expired authorization code");
      if (p.redirect_uri && p.redirect_uri !== code.redirectUri) return fail("invalid_grant", "redirect_uri mismatch");
      userId = code.userId;
    } else if (p.grant_type === "refresh_token") {
      if (!p.refresh_token) return fail("invalid_request", "refresh_token is required");
      const rt = await consumeToken(p.refresh_token, "refresh", clientId);
      if (!rt) return fail("invalid_grant", "Invalid or expired refresh token");
      userId = rt.userId;
    } else {
      return fail("unsupported_grant_type", "Use authorization_code or refresh_token");
    }

    // Re-check the account on every issuance: disabled / non-company users get nothing
    const user = await db.user.findUnique({ where: { id: userId }, select: { status: true, email: true } });
    if (!user || user.status === "DISABLED" || !isCompanyEmail(user.email)) return fail("invalid_grant", "Account is not allowed to use AI tools");

    return Response.json(await issueTokens(userId, clientId), { headers: { "Cache-Control": "no-store" } });
  },
  { n: 30, ms: 60_000 }
);

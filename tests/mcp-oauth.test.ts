import crypto from "crypto";
import { describe, it, expect, afterEach } from "vitest";
import { isAllowedRedirectUri, verifyPkce } from "@/lib/auth/oauth";
import { isCompanyEmail } from "@/lib/auth/session";
import { TOOLS } from "@/lib/mcp/tools";

describe("MCP OAuth helpers", () => {
  it("verifies PKCE S256", () => {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(verifier + "x", challenge)).toBe(false);
  });

  it("allows only https or loopback redirect URIs", () => {
    expect(isAllowedRedirectUri("http://localhost:5555/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:5555/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://evil.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    // https only for admin-allowlisted hosts (blocks consent phishing via open registration)
    expect(isAllowedRedirectUri("https://evil.com/cb")).toBe(false);
    process.env.MCP_ALLOWED_REDIRECT_HOSTS = "claude.ai";
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("https://claude.ai.evil.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/cb#frag")).toBe(false);
  });

  afterEach(() => { delete process.env.ALLOWED_EMAIL_DOMAINS; delete process.env.MCP_ALLOWED_REDIRECT_HOSTS; });
  it("restricts to company domains only when configured", () => {
    expect(isCompanyEmail("a@anything.com")).toBe(true);
    process.env.ALLOWED_EMAIL_DOMAINS = "strike.io, acme.com";
    expect(isCompanyEmail("a@Strike.io")).toBe(true);
    expect(isCompanyEmail("a@gmail.com")).toBe(false);
  });

  it("has unique tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

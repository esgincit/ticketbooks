import crypto from "crypto";
import { describe, it, expect, afterEach } from "vitest";
import { isAllowedRedirectUri, matchesRegisteredRedirect, verifyPkce } from "@/lib/auth/oauth";
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

  it("allows ChatGPT's exact return address, and nothing else on chatgpt.com", () => {
    expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect/x")).toBe(false);
    expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect?x=1")).toBe(false);
    expect(isAllowedRedirectUri("https://chatgpt.com/evil")).toBe(false);
    expect(isAllowedRedirectUri("http://chatgpt.com/connector_platform_oauth_redirect")).toBe(false);
  });

  it("accepts any port on the registered loopback address only", () => {
    const reg = ["http://127.0.0.1:5555/callback", "http://localhost/cb"];
    expect(matchesRegisteredRedirect(reg, "http://127.0.0.1:5555/callback")).toBe(true);
    expect(matchesRegisteredRedirect(reg, "http://127.0.0.1:61234/callback")).toBe(true);
    expect(matchesRegisteredRedirect(reg, "http://127.0.0.1/callback")).toBe(true);
    expect(matchesRegisteredRedirect(reg, "http://localhost:49152/cb")).toBe(true);
    // Different path, host or scheme is not the registered address
    expect(matchesRegisteredRedirect(reg, "http://127.0.0.1:61234/other")).toBe(false);
    expect(matchesRegisteredRedirect(reg, "http://localhost:61234/callback")).toBe(false);
    expect(matchesRegisteredRedirect(reg, "https://127.0.0.1:61234/callback")).toBe(false);
    expect(matchesRegisteredRedirect(reg, "http://127.0.0.1.evil.com:5555/callback")).toBe(false);
    expect(matchesRegisteredRedirect(reg, "http://evil.com:5555/callback")).toBe(false);
    expect(matchesRegisteredRedirect(reg, "not a url")).toBe(false);
    // Web addresses stay exact, port included
    const web = ["https://claude.ai/cb"];
    expect(matchesRegisteredRedirect(web, "https://claude.ai/cb")).toBe(true);
    expect(matchesRegisteredRedirect(web, "https://claude.ai:8443/cb")).toBe(false);
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

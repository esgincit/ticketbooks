import crypto from "crypto";
import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { isAllowedRedirectUri, knownConnectorName, resolveRegisteredRedirect, verifyPkce } from "@/lib/auth/oauth";
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

  it("returns a 127.0.0.1 app to 127.0.0.1 even though Next rewrites it on a real domain", () => {
    const req = new NextRequest("https://strike.example.com/api/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A54974%2Fcallback");
    const received = new URL(req.url).searchParams.get("redirect_uri")!;
    expect(received).toBe("http://localhost:54974/callback"); // the Next behaviour this works around
    expect(resolveRegisteredRedirect(["http://127.0.0.1:54974/callback"], received)).toBe("http://127.0.0.1:54974/callback");
    expect(resolveRegisteredRedirect(["http://127.0.0.1:5555/callback"], received)).toBe("http://127.0.0.1:54974/callback");
    expect(resolveRegisteredRedirect(["http://[::1]:5555/callback"], received)).toBe("http://[::1]:54974/callback");
    // A client that registered localhost itself stays on localhost
    expect(resolveRegisteredRedirect(["http://127.0.0.1:1/callback", "http://localhost:1/callback"], received)).toBe(received);
  });

  it("names ChatGPT from its address, and can be switched off", () => {
    const uri = "https://chatgpt.com/connector_platform_oauth_redirect";
    expect(knownConnectorName(uri)).toBe("ChatGPT");
    expect(knownConnectorName("http://127.0.0.1:5555/cb")).toBeNull();
    process.env.MCP_DISABLE_CHATGPT = "true";
    expect(knownConnectorName(uri)).toBeNull();
    expect(isAllowedRedirectUri(uri)).toBe(false);
    delete process.env.MCP_DISABLE_CHATGPT;
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it("accepts any port on the registered loopback address only", () => {
    const reg = ["http://127.0.0.1:5555/callback", "http://localhost/cb"];
    expect(resolveRegisteredRedirect(reg, "http://127.0.0.1:5555/callback")).toBe("http://127.0.0.1:5555/callback");
    expect(resolveRegisteredRedirect(reg, "http://127.0.0.1:61234/callback")).toBe("http://127.0.0.1:61234/callback");
    expect(resolveRegisteredRedirect(reg, "http://127.0.0.1/callback")).toBe("http://127.0.0.1/callback");
    expect(resolveRegisteredRedirect(reg, "http://localhost:49152/cb")).toBe("http://localhost:49152/cb");
    // Different path, host or scheme is not the registered address
    expect(resolveRegisteredRedirect(reg, "http://127.0.0.1:61234/other")).toBeNull();
    expect(resolveRegisteredRedirect(reg, "http://localhost:61234/other")).toBeNull();
    expect(resolveRegisteredRedirect(reg, "http://127.0.0.1:61234/cb")).toBeNull();
    expect(resolveRegisteredRedirect(reg, "https://127.0.0.1:61234/callback")).toBeNull();
    expect(resolveRegisteredRedirect(reg, "http://127.0.0.1.evil.com:5555/callback")).toBeNull();
    expect(resolveRegisteredRedirect(reg, "http://evil.com:5555/callback")).toBeNull();
    expect(resolveRegisteredRedirect(reg, "not a url")).toBeNull();
    // A web client gets no loopback, and web addresses stay exact, port included
    const web = ["https://claude.ai/cb"];
    expect(resolveRegisteredRedirect(web, "https://claude.ai/cb")).toBe("https://claude.ai/cb");
    expect(resolveRegisteredRedirect(web, "https://claude.ai:8443/cb")).toBeNull();
    expect(resolveRegisteredRedirect(web, "http://localhost:1/cb")).toBeNull();
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

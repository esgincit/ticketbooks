import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/constants";
import { getSessionUser, isCompanyEmail, type SessionUser } from "@/lib/auth/session";
import { createCode, isAllowedRedirectUri, originOf } from "@/lib/auth/oauth";

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state"] as const;
type Params = Record<(typeof FIELDS)[number], string>;

/**
 * OAuth authorize endpoint. Requires a signed-in Strike user (normal login page),
 * then asks them to approve the AI tool. Only then is a single-use code issued.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = Object.fromEntries(FIELDS.map((f) => [f, url.searchParams.get(f) ?? ""])) as Params;
  const checked = await check(p);
  if ("page" in checked) return checked.page;

  const user = await getSessionUser();
  if (!user) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", url.pathname + url.search);
    // A stale cookie would make /login bounce to /dashboard; clear it
    return new Response(null, { status: 302, headers: { Location: login.toString(), "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0` } });
  }
  if (!isCompanyEmail(user.email)) return page("Not allowed", "Only company accounts can connect AI tools.", 403);
  return consent(p, checked.clientName, user);
}

export async function POST(req: Request) {
  // Form posts from our own consent page only (blocks cross-site auto-submits)
  if (req.headers.get("origin") !== originOf(req)) return page("Invalid request", "Request origin not allowed.", 403);
  const form = await req.formData().catch(() => null);
  if (!form) return page("Invalid request", "Expected a form submission.", 400);
  const p = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")])) as Params;
  const checked = await check(p);
  if ("page" in checked) return checked.page;

  const user = await getSessionUser();
  if (!user) return page("Signed out", "Your Strike session ended. Start the connection again from your AI tool.", 401);
  if (!isCompanyEmail(user.email)) return page("Not allowed", "Only company accounts can connect AI tools.", 403);

  const back = new URL(p.redirect_uri);
  if (p.state) back.searchParams.set("state", p.state);
  if (form.get("decision") !== "allow") {
    back.searchParams.set("error", "access_denied");
  } else {
    back.searchParams.set("code", await createCode(user.id, p.client_id, p.code_challenge, p.redirect_uri));
    await db.auditLog.create({ data: { userId: user.id, action: "AI_TOOL_CONNECTED", entityType: "McpClient", entityId: p.client_id } });
  }
  return new Response(null, { status: 303, headers: { Location: back.toString() } });
}

async function check(p: Params): Promise<{ clientName: string } | { page: Response }> {
  const client = p.client_id ? await db.mcpClient.findUnique({ where: { id: p.client_id } }) : null;
  if (!client) return { page: page("Unknown application", "This AI tool is not registered. Reconnect it from the tool.", 400) };
  const uris = Array.isArray(client.redirectUris) ? (client.redirectUris as string[]) : [];
  // Never redirect to an unregistered URI
  // Re-checked against the current allowlist so removing a host takes effect immediately
  if (!uris.includes(p.redirect_uri) || !isAllowedRedirectUri(p.redirect_uri)) return { page: page("Invalid redirect", "The redirect URI does not match the registered application.", 400) };
  if (p.response_type !== "code" || !p.code_challenge || p.code_challenge_method !== "S256") {
    const back = new URL(p.redirect_uri);
    back.searchParams.set("error", "invalid_request");
    back.searchParams.set("error_description", "response_type=code and PKCE (S256) are required");
    if (p.state) back.searchParams.set("state", p.state);
    return { page: new Response(null, { status: 302, headers: { Location: back.toString() } }) };
  }
  return { clientName: client.name };
}

function consent(p: Params, clientName: string, user: SessionUser) {
  const hidden = FIELDS.map((f) => `<input type="hidden" name="${f}" value="${esc(p[f])}">`).join("");
  const dest = new URL(p.redirect_uri);
  const local = dest.protocol === "http:";
  return html(
    "Connect AI tool",
    `<h1>Allow <b>${esc(clientName)}</b> to use Strike?</h1>
     <p>The app name is self-reported. ${local
       ? "Access will be handed to an app running <b>on this computer</b>. Only allow if you just started this connection yourself (for example from Claude Code)."
       : `Access will be sent to <b>${esc(dest.host)}</b>.`}</p>
     <p>It will act as <b>${esc(user.firstName)} ${esc(user.lastName)}</b> (${esc(user.email)}) with your <b>${esc(user.roleName)}</b> permissions:
     view, create and update tickets, comments, projects and everything else your role allows.</p>
     <form method="post" action="/api/oauth/authorize">${hidden}
       <button name="decision" value="allow" class="primary">Allow</button>
       <button name="decision" value="deny">Deny</button>
     </form>`,
    200
  );
}

function page(title: string, message: string, status: number) {
  return html(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`, status);
}

function html(title: string, body: string, status: number) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - Strike</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#111;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;max-width:440px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;color:#374151}
button{font:inherit;padding:8px 18px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;margin-right:8px}.primary{background:#4f46e5;border-color:#4f46e5;color:#fff}</style>
</head><body><main>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } }
  );
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

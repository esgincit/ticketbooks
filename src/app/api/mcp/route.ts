import { getBearerUser } from "@/lib/auth/session";
import { originOf } from "@/lib/auth/oauth";
import { callTool, hasTool, listTools } from "@/lib/mcp/tools";

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];
export const runtime = "nodejs";
export const maxDuration = 60;

// ponytail: stateless JSON-response mode of MCP Streamable HTTP (no SSE stream, no sessions) -
// tools are request/response so nothing needs server push; add SSE if streaming/progress is ever needed.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** MCP endpoint. Only OAuth Bearer tokens (issued after a company login) are accepted. */
export async function POST(req: Request) {
  const user = await getBearerUser();
  if (!user) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in to Strike to use this server" } },
      { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource"` } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const ctx = { origin: originOf(req), forwardedFor: req.headers.get("x-forwarded-for") ?? "mcp" };
  const messages = (Array.isArray(body) ? body : [body]) as RpcMessage[];
  const replies = (await Promise.all(messages.map((m) => handle(m, ctx)))).filter(Boolean);
  if (replies.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export const DELETE = GET;

async function handle(m: RpcMessage, ctx: { origin: string; forwardedFor: string }) {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return { jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  if (m.id === undefined || m.id === null) return null; // notification: nothing to answer
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } });

  switch (m.method) {
    case "initialize": {
      const requested = String(m.params?.protocolVersion ?? "");
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "strike", version: "1.0.0" },
        instructions:
          "Strike ticketing. You act as the signed-in user with their role's permissions. " +
          "Call get_reference_data first to resolve project/status/priority/type/user/label IDs. Ticket keys look like OPS-1042.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: listTools() });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      if (!hasTool(name)) return fail(-32602, `Unknown tool: ${name}`);
      const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
      return reply(await callTool(name, args, ctx.origin, ctx.forwardedFor));
    }
    default:
      return fail(-32601, `Method not found: ${m.method}`);
  }
}

import { originOf } from "@/lib/auth/oauth";

/** RFC 9728: tells MCP clients which authorization server protects /api/mcp */
export function GET(req: Request) {
  const origin = originOf(req);
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  });
}

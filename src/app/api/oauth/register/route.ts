import { z } from "zod";
import { db } from "@/lib/db";
import { publicRoute } from "@/lib/api";
import { isAllowedRedirectUri } from "@/lib/auth/oauth";

const schema = z.object({
  client_name: z.string().max(100).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
});

/** RFC 7591 dynamic client registration (public clients). Registering grants nothing - the user still signs in. */
export const POST = publicRoute(
  async (req) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !parsed.data.redirect_uris.every(isAllowedRedirectUri)) {
      return Response.json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be http://localhost (or https on an admin-allowed host)" }, { status: 400 });
    }
    const client = await db.mcpClient.create({
      data: { name: parsed.data.client_name || "AI tool", redirectUris: parsed.data.redirect_uris },
    });
    return Response.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: parsed.data.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      },
      { status: 201 }
    );
  },
  { n: 20, ms: 60_000 }
);

import { getSessionUser } from "@/lib/auth/session";
import { subscribe } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep the function next to the database (Supabase: ap-southeast-1)
export const preferredRegion = ["sin1"];

/** Server-Sent Events stream for realtime notifications & ticket updates */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };

      send("connected", { userId: user.id, at: Date.now() });

      unsubscribe = subscribe((evt) => {
        // notification events are targeted; ticket events broadcast to all
        if (evt.type === "notification" && !evt.userIds.includes(user.id)) return;
        send(evt.type === "notification" ? "notification" : "ticket-update", evt.payload ?? {});
      });

      heartbeat = setInterval(() => send("ping", { at: Date.now() }), 25_000);

      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

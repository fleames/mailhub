import { NextRequest } from "next/server";
import { bus, type SseEvent } from "@/lib/bus";

/** Server-Sent Events stream driving live UI updates. */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: SseEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        } catch {
          cleanup();
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        bus.off("sse", send);
        try {
          controller.close();
        } catch {}
      };

      bus.on("sse", send);
      req.signal.addEventListener("abort", cleanup);
      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));
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

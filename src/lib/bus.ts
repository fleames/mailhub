import { EventEmitter } from "events";
import { db, t } from "@/db";

/**
 * In-process event bus. Feeds the SSE endpoint for live UI updates
 * and the append-only events table (audit log / activity feed).
 */

export type SseEvent = {
  type: string;
  data: Record<string, unknown>;
};

const globalForBus = globalThis as unknown as { mhBus?: EventEmitter };
export const bus =
  globalForBus.mhBus ?? (globalForBus.mhBus = new EventEmitter());
bus.setMaxListeners(50);

export function emitSse(type: string, data: Record<string, unknown> = {}) {
  bus.emit("sse", { type, data } satisfies SseEvent);
}

export async function logEvent(
  type: string,
  opts: {
    conversationId?: string | null;
    messageId?: string | null;
    payload?: Record<string, unknown>;
  } = {}
) {
  try {
    await db.insert(t.events).values({
      type,
      conversationId: opts.conversationId ?? null,
      messageId: opts.messageId ?? null,
      payload: opts.payload ?? {},
    });
  } catch (err) {
    console.error("logEvent failed:", err);
  }
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi, useSse, timeAgo } from "@/lib/client/hooks";
import { Button, Spinner } from "@/components/ui";

type EventRow = {
  id: string;
  type: string;
  conversationId: string | null;
  messageId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

const PAGE_SIZE = 50;

/** Full audit log — every ingest, send, delivery event, and change. */
export default function ActivityPage() {
  const { data, setData, loading, refresh } = useApi<{
    items: EventRow[];
    nextCursor: string | null;
  }>(`/api/events?limit=${PAGE_SIZE}`);
  const [loadingMore, setLoadingMore] = useState(false);
  const items = data?.items ?? [];

  useSse(() => void refresh(), ["message.new", "message.sent", "message.status", "conversation.updated"]);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const more = await api<{ items: EventRow[]; nextCursor: string | null }>(
        `/api/events?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(data.nextCursor)}`
      );
      setData({ items: [...items, ...more.items], nextCursor: more.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4.5 w-4.5 text-mut" />
          <h1 className="text-lg font-semibold tracking-tight">Activity log</h1>
        </div>
        {loading && items.length === 0 && <Spinner />}
        <div className="overflow-hidden rounded-2xl border border-edge-soft">
          {items.map((e) => {
            const summary =
              String(
                e.payload.subject ?? e.payload.from ?? e.payload.note ?? e.payload.error ?? ""
              ) || JSON.stringify(e.payload).slice(0, 80);
            const row = (
              <div className="flex items-center gap-3 border-b border-edge-soft bg-panel px-4 py-2.5 text-[13px] last:border-0 hover:bg-elev">
                <code className="w-44 shrink-0 truncate rounded bg-elev px-1.5 py-0.5 font-mono text-[11px] text-mut">
                  {e.type}
                </code>
                <span className="min-w-0 flex-1 truncate text-mut">{summary}</span>
                <span className="shrink-0 text-[11px] text-mut2">{timeAgo(e.createdAt)}</span>
              </div>
            );
            return e.conversationId ? (
              <Link key={e.id} href={`/mail/all?c=${e.conversationId}`}>{row}</Link>
            ) : (
              <div key={e.id}>{row}</div>
            );
          })}
          {!loading && items.length === 0 && (
            <p className="bg-panel px-4 py-10 text-center text-sm text-mut2">No events yet.</p>
          )}
        </div>
        {data?.nextCursor && (
          <div className="p-3 text-center">
            <Button size="sm" onClick={loadMore} busy={loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

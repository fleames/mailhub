"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Minimal SWR-style fetch hook with manual refresh. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  });

  const refresh = useCallback(async (silent = true) => {
    const p = pathRef.current;
    if (!p) return;
    if (!silent) setLoading(true);
    try {
      const result = await api<T>(p);
      if (pathRef.current === p) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (pathRef.current === p) setError(err instanceof Error ? err.message : "Failed");
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting to an external prop change (path -> null), not a derivable render value
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  return { data, setData, loading, error, refresh };
}

export type SseHandler = (type: string, data: Record<string, unknown>) => void;

/** Subscribe to the app-wide SSE stream. Auto-reconnects. */
export function useSse(handler: SseHandler, events: string[]) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  const eventsKey = events.join(",");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/sse");
      for (const type of eventsKey.split(",").filter(Boolean)) {
        es.addEventListener(type, (e) => {
          try {
            handlerRef.current(type, JSON.parse((e as MessageEvent).data));
          } catch {
            handlerRef.current(type, {});
          }
        });
      }
      es.onerror = () => {
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [eventsKey]);
}

/** Register global keyboard shortcuts (skips when typing in inputs). */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>) {
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      let combo = "";
      if (e.metaKey || e.ctrlKey) combo += "mod+";
      if (e.shiftKey && e.key.length > 1) combo += "shift+";
      combo += e.key.toLowerCase();

      const fn = mapRef.current[combo];
      if (!fn) return;
      // Plain-letter shortcuts don't fire while typing; mod-combos always do.
      if (typing && !combo.startsWith("mod+") && combo !== "escape") return;
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

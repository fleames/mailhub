"use client";

import { useMemo, useRef } from "react";
import DOMPurify from "isomorphic-dompurify";
import type { Message } from "@/lib/client/types";

/**
 * Renders an email body safely:
 * - HTML is DOMPurify-sanitized, cid: images rewritten to attachment URLs,
 *   then rendered in a sandboxed iframe (no scripts) on a white canvas
 *   for fidelity with how senders design email.
 * - Plain text renders directly.
 */
export function MessageBody({ message }: { message: Message }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const html = useMemo(() => {
    if (!message.htmlBody) return null;
    let body = message.htmlBody;

    // Rewrite inline cid: references to attachment endpoints
    for (const att of message.attachments) {
      if (att.contentId) {
        body = body.split(`cid:${att.contentId}`).join(`/api/attachments/${att.id}`);
      }
    }

    const clean = DOMPurify.sanitize(body, {
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base"],
      FORBID_ATTR: ["onerror", "onload", "onclick"],
      WHOLE_DOCUMENT: true,
    });

    return `<!doctype html><html><head><meta charset="utf-8">
<base target="_blank">
<style>
  body { margin: 0; padding: 16px; background: #ffffff; color: #1a1a2e;
    font: 13.5px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    word-break: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #4f46e5; }
  pre { white-space: pre-wrap; }
  blockquote { border-left: 3px solid #d8dbe8; margin: 8px 0; padding-left: 12px; color: #5d6479; }
</style></head><body>${clean}</body></html>`;
  }, [message]);

  if (html) {
    return (
      <iframe
        ref={iframeRef}
        srcDoc={html}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full rounded-lg bg-white"
        style={{ minHeight: 80, colorScheme: "light" }}
        onLoad={() => {
          const frame = iframeRef.current;
          const doc = frame?.contentDocument;
          if (frame && doc) {
            frame.style.height = `${Math.min(doc.documentElement.scrollHeight + 8, 1600)}px`;
          }
        }}
        title="Email content"
      />
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-ink">
      {message.textBody ?? "(empty message)"}
    </pre>
  );
}

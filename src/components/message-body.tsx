"use client";

import { useMemo } from "react";
import type { Message } from "@/lib/client/types";
import { EmailHtmlFrame } from "./email-html-frame";

/**
 * Renders an email body safely:
 * - HTML is DOMPurify-sanitized, cid: images rewritten to attachment URLs,
 *   then rendered in a sandboxed iframe (no scripts) on a white canvas
 *   for fidelity with how senders design email.
 * - Plain text renders directly.
 */
export function MessageBody({ message }: { message: Message }) {
  const html = useMemo(() => {
    if (!message.htmlBody) return null;
    let body = message.htmlBody;

    // Rewrite inline cid: references to attachment endpoints
    for (const att of message.attachments) {
      if (att.contentId) {
        body = body.split(`cid:${att.contentId}`).join(`/api/attachments/${att.id}`);
      }
    }

    return body;
  }, [message]);

  if (html) {
    return (
      <EmailHtmlFrame
        html={html}
        sanitize
        autoHeight
        className="rounded-lg"
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { Eye, Monitor, Send, Smartphone, X } from "lucide-react";
import { looksLikeFullHtmlDocument, wrapEmailHtmlForPreview } from "@/lib/email-html";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "./ui";

const EMAIL_PURIFY = {
  ADD_TAGS: ["center", "font"],
  ADD_ATTR: [
    "target",
    "bgcolor",
    "background",
    "cellpadding",
    "cellspacing",
    "valign",
    "align",
    "width",
    "height",
    "border",
    "hspace",
    "vspace",
    "color",
    "face",
    "size",
    "colspan",
    "rowspan",
    "role",
    "noshade",
    "nowrap",
  ],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onmouseenter"],
};

export function EmailHtmlFrame({
  html,
  sanitize = false,
  autoHeight = false,
  className,
  title = "Email content",
}: {
  html: string;
  sanitize?: boolean;
  autoHeight?: boolean;
  className?: string;
  title?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => {
    const cleaned = sanitize
      ? DOMPurify.sanitize(html, {
          ...EMAIL_PURIFY,
          WHOLE_DOCUMENT: looksLikeFullHtmlDocument(html),
        })
      : html;
    return wrapEmailHtmlForPreview(cleaned);
  }, [html, sanitize]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className={cn("block w-full border-0 bg-white", className)}
      style={{ colorScheme: "light", ...(autoHeight ? { minHeight: 80 } : { height: "100%" }) }}
      onLoad={() => {
        if (!autoHeight) return;
        const frame = iframeRef.current;
        const doc = frame?.contentDocument;
        if (frame && doc) {
          frame.style.height = `${Math.min(doc.documentElement.scrollHeight + 8, 1600)}px`;
        }
      }}
      title={title}
    />
  );
}

export function EmailPreviewModal({
  html,
  subject,
  fromLabel,
  toLabel,
  sending,
  onClose,
  onSend,
  sendLabel = "Send",
}: {
  html: string;
  subject: string;
  fromLabel?: string;
  toLabel?: string;
  sending?: boolean;
  onClose: () => void;
  onSend?: () => void;
  sendLabel?: string;
}) {
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="anim-fade fixed inset-0 z-[60] flex flex-col bg-black/70 p-4 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="anim-pop mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge-soft px-3">
          <Eye className="h-3.5 w-3.5 text-mut2" />
          <span className="text-[13px] font-medium">Preview</span>
          <span className="truncate text-[12px] text-mut2">{subject || "(no subject)"}</span>
          <div className="flex-1" />
          <div className="flex overflow-hidden rounded-lg border border-edge">
            <IconButton
              label="Desktop width"
              active={viewport === "desktop"}
              onClick={() => setViewport("desktop")}
              className="rounded-none"
            >
              <Monitor className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Mobile width"
              active={viewport === "mobile"}
              onClick={() => setViewport("mobile")}
              className="rounded-none"
            >
              <Smartphone className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <IconButton label="Close preview" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        {(fromLabel || toLabel) && (
          <div className="shrink-0 space-y-0.5 border-b border-edge-soft bg-elev px-4 py-2 text-[12px]">
            {fromLabel && (
              <div className="flex gap-2">
                <span className="w-10 shrink-0 text-mut2">From</span>
                <span className="truncate">{fromLabel}</span>
              </div>
            )}
            {toLabel && (
              <div className="flex gap-2">
                <span className="w-10 shrink-0 text-mut2">To</span>
                <span className="truncate">{toLabel}</span>
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden bg-[#d8dbe3] p-4 sm:p-6">
          <div
            className="mx-auto h-full overflow-hidden rounded-lg bg-white shadow-lg"
            style={{ width: viewport === "mobile" ? 375 : "min(640px, 100%)", maxWidth: "100%" }}
          >
            <EmailHtmlFrame html={html} title="Email preview" className="h-full" />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-edge-soft bg-elev/50 px-3 py-2.5">
          <p className="text-[11px] text-mut2">
            This is how the HTML will look in most email clients. Scripts never run.
          </p>
          <div className="flex-1" />
          <Button onClick={onClose}>Back to edit</Button>
          {onSend && (
            <Button variant="primary" onClick={onSend} busy={sending}>
              <Send className="h-3.5 w-3.5" />
              {sendLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

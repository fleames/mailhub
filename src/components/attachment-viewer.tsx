"use client";

import { useEffect } from "react";
import { Download, X, FileText, FileArchive, FileSpreadsheet, File as FileIcon, ImageIcon } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { Attachment } from "@/lib/client/types";
import { IconButton } from "./ui";

export function attachmentIcon(contentType: string) {
  if (contentType.startsWith("image/")) return ImageIcon;
  if (contentType === "application/pdf") return FileText;
  if (/zip|compressed|tar/.test(contentType)) return FileArchive;
  if (/sheet|excel|csv/.test(contentType)) return FileSpreadsheet;
  return FileIcon;
}

/** Full-screen attachment preview: images, PDFs, text; download fallback for the rest. */
export function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = `/api/attachments/${attachment.id}`;
  const isImage = attachment.contentType.startsWith("image/");
  const isPdf = attachment.contentType === "application/pdf";
  const isText = /^text\/|json|xml/.test(attachment.contentType);
  const previewable = isImage || isPdf || isText;

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex flex-col bg-black/85"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-13 shrink-0 items-center gap-3 px-4">
        <span className="truncate text-sm text-white/90">{attachment.filename}</span>
        <span className="text-xs text-white/50">{formatBytes(attachment.sizeBytes)}</span>
        <div className="flex-1" />
        <a
          href={`${url}?download=1`}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/20"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
        <IconButton label="Close" onClick={onClose} className="text-white/70 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {isImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={attachment.filename} className="anim-pop max-h-full max-w-full rounded-lg object-contain" />
        )}
        {(isPdf || isText) && (
          <iframe src={url} className="anim-pop h-full w-full max-w-4xl rounded-lg bg-white" title={attachment.filename} />
        )}
        {!previewable && (
          <div className="anim-pop rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <FileIcon className="mx-auto mb-3 h-10 w-10 text-white/40" />
            <p className="mb-1 text-sm text-white/80">{attachment.filename}</p>
            <p className="mb-4 text-xs text-white/50">
              No in-browser preview for {attachment.contentType} — download to open.
            </p>
            <a
              href={`${url}?download=1`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-sm text-white transition hover:bg-white/25"
            >
              <Download className="h-4 w-4" /> Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import { toast } from "sonner";
import {
  X,
  Minus,
  Paperclip,
  Send,
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Code,
  Link2,
  CalendarClock,
  Sparkles,
  Languages,
  Wand2,
  FileText,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { api } from "@/lib/client/api";
import type { Address, Contact, Signature, Template, UploadedAttachment } from "@/lib/client/types";
import { useShell } from "./shell";
import { Button, IconButton, Menu, MenuItem } from "./ui";

export type ComposeSeed = {
  to?: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject?: string;
  html?: string;
  mailboxId?: string;
  replyToMessageId?: string | null;
  conversationId?: string | null;
  draftId?: string | null;
  attachments?: UploadedAttachment[];
};

/* ---------- Address chips input with contact autocomplete ---------- */

function AddressInput({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: Address[];
  onChange: (v: Address[]) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (text.trim().length < 1 || !focused) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const rows = await api<Contact[]>(`/api/contacts?q=${encodeURIComponent(text.trim())}`);
        setSuggestions(rows.slice(0, 5).filter((c) => !value.some((a) => a.email === c.email)));
      } catch {}
    }, 150);
    return () => clearTimeout(timer);
  }, [text, focused, value]);

  const commit = (raw: string) => {
    const email = raw.trim().replace(/[,;]$/, "");
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(`"${email}" is not a valid address`);
      return;
    }
    if (!value.some((a) => a.email === email.toLowerCase())) {
      onChange([...value, { email: email.toLowerCase() }]);
    }
    setText("");
  };

  return (
    <div className="relative flex min-h-8 flex-wrap items-center gap-1 border-b border-edge-soft px-3 py-1">
      <span className="w-8 text-xs text-mut2">{label}</span>
      {value.map((a) => (
        <span
          key={a.email}
          className="flex items-center gap-1 rounded-full bg-elev px-2 py-0.5 text-xs"
          title={a.email}
        >
          {a.name || a.email}
          <button
            className="text-mut2 hover:text-danger"
            onClick={() => onChange(value.filter((v) => v.email !== a.email))}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setTimeout(() => setFocused(false), 150);
          if (text.trim()) commit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
            if (text.trim()) {
              e.preventDefault();
              commit(text);
            }
          }
          if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        className="min-w-24 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-mut2"
        placeholder={value.length === 0 ? "recipient@example.com" : ""}
      />
      {focused && suggestions.length > 0 && (
        <div className="anim-pop absolute left-10 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-edge bg-elev shadow-2xl">
          {suggestions.map((c) => (
            <button
              key={c.id}
              className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-elev2"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange([...value, { email: c.email, name: c.name ?? undefined }]);
                setText("");
              }}
            >
              <span className="text-[13px]">{c.name || c.email}</span>
              {c.name && <span className="text-xs text-mut2">{c.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Composer ---------- */

export function Composer({ seed, onClose }: { seed: ComposeSeed; onClose: () => void }) {
  const { mailboxes } = useShell();
  const [minimized, setMinimized] = useState(false);
  const [mailboxId, setMailboxId] = useState(seed.mailboxId ?? "");
  const [to, setTo] = useState<Address[]>(seed.to ?? []);
  const [cc, setCc] = useState<Address[]>(seed.cc ?? []);
  const [bcc, setBcc] = useState<Address[]>(seed.bcc ?? []);
  const [showCc, setShowCc] = useState((seed.cc?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((seed.bcc?.length ?? 0) > 0);
  const [subject, setSubject] = useState(seed.subject ?? "");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>(seed.attachments ?? []);
  const [mode, setMode] = useState<"rich" | "markdown">("rich");
  const [markdown, setMarkdown] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(seed.draftId ?? null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const signatureApplied = useRef(Boolean(seed.html));
  const dirty = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write your email…" }),
    ],
    content: seed.html ?? "",
    editorProps: {
      attributes: { class: "tiptap px-4 py-3 text-[13.5px]" },
    },
    onUpdate: () => {
      dirty.current = true;
    },
  });

  // Default mailbox + metadata
  useEffect(() => {
    void api<Template[]>("/api/templates").then(setTemplates).catch(() => {});
    void api<Signature[]>("/api/signatures").then(setSignatures).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mailboxId && mailboxes.length > 0) {
      setMailboxId(
        seed.mailboxId ??
          mailboxes.find((m) => m.isDefault)?.id ??
          mailboxes[0].id
      );
    }
  }, [mailboxes, mailboxId, seed.mailboxId]);

  // Apply signature once (mailbox signature, else default)
  useEffect(() => {
    if (signatureApplied.current || !editor || !mailboxId || signatures.length === 0) return;
    const mailbox = mailboxes.find((m) => m.id === mailboxId);
    const sig =
      signatures.find((s) => s.id === mailbox?.signatureId) ??
      signatures.find((s) => s.isDefault);
    if (sig) {
      editor.commands.insertContentAt(editor.state.doc.content.size, `<p></p><p></p>${sig.html}`);
      signatureApplied.current = true;
    }
  }, [editor, mailboxId, signatures, mailboxes]);

  const currentHtml = useCallback((): string => {
    if (mode === "markdown") return marked.parse(markdown, { async: false }) as string;
    return editor?.getHTML() ?? "";
  }, [mode, markdown, editor]);

  // Draft autosave (debounced 2.5s after edits)
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      try {
        const saved = await api<{ id: string }>("/api/drafts", {
          method: "POST",
          json: {
            id: draftId ?? undefined,
            mailboxId: mailboxId || null,
            conversationId: seed.conversationId ?? null,
            replyToMessageId: seed.replyToMessageId ?? null,
            to,
            cc,
            bcc,
            subject,
            bodyHtml: currentHtml(),
            attachments,
          },
        });
        setDraftId(saved.id);
      } catch {}
    }, 2500);
    return () => clearInterval(timer);
  }, [draftId, mailboxId, to, cc, bcc, subject, attachments, currentHtml, seed]);

  const markDirty = () => {
    dirty.current = true;
  };

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error ?? `Upload failed: ${file.name}`);
          continue;
        }
        const uploaded = (await res.json()) as UploadedAttachment;
        setAttachments((prev) => [...prev, uploaded]);
        markDirty();
      }
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    const html = currentHtml();
    if (to.length === 0) return toast.error("Add at least one recipient");
    if (!mailboxId) return toast.error("Pick a From mailbox");
    if (!subject.trim() && !confirm("Send without a subject?")) return;

    setSending(true);
    try {
      const result = await api<{ messageId: string; undoSeconds: number }>(
        "/api/messages/send",
        {
          method: "POST",
          json: {
            mailboxId,
            to,
            cc,
            bcc,
            subject,
            html,
            attachments,
            replyToMessageId: seed.replyToMessageId ?? null,
            scheduledAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
            draftId,
          },
        }
      );
      onClose();
      if (scheduleAt) {
        toast.success(`Scheduled for ${new Date(scheduleAt).toLocaleString()}`);
      } else {
        let undone = false;
        toast.success("Sending…", {
          duration: result.undoSeconds * 1000,
          action: {
            label: "Undo",
            onClick: async () => {
              if (undone) return;
              undone = true;
              try {
                await api(`/api/messages/${result.messageId}/undo`, { method: "POST" });
                toast.info("Send undone — reopen it from Drafts? It's back in the composer.", { duration: 4000 });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Too late to undo");
              }
            },
          },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function runAi(action: "rewrite" | "translate" | "subject") {
    const html = currentHtml();
    if (!html || html === "<p></p>") return toast.error("Write something first");
    let instruction: string | undefined;
    let targetLang: string | undefined;
    if (action === "rewrite") {
      instruction = prompt("How should I rewrite it? (e.g. 'more formal', 'shorter')") ?? undefined;
      if (instruction === undefined) return;
    }
    if (action === "translate") {
      targetLang = prompt("Translate to which language?", "English") ?? undefined;
      if (!targetLang) return;
    }
    setAiBusy(action);
    try {
      const { result } = await api<{ result: string }>("/api/ai/rewrite", {
        method: "POST",
        json: { mode: action === "subject" ? "subject" : action, text: html, instruction, targetLang },
      });
      if (action === "subject") {
        setSubject(result);
      } else if (mode === "markdown") {
        setMarkdown(result);
      } else {
        editor?.commands.setContent(
          `<div style="white-space:pre-wrap">${result
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</div>`
        );
      }
      markDirty();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setAiBusy(null);
    }
  }

  function switchMode() {
    if (mode === "rich") {
      // Rich -> markdown: keep it simple, use text
      setMarkdown(editor?.getText() ?? "");
      setMode("markdown");
    } else {
      editor?.commands.setContent(marked.parse(markdown, { async: false }) as string);
      setMode("rich");
    }
  }

  async function discard() {
    if (draftId) {
      await api(`/api/drafts/${draftId}`, { method: "DELETE" }).catch(() => {});
    }
    onClose();
    toast("Draft discarded");
  }

  const mailboxOptions = useMemo(
    () =>
      [...mailboxes].sort((a, b) =>
        (a.domain?.name ?? "").localeCompare(b.domain?.name ?? "") ||
        a.localPart.localeCompare(b.localPart)
      ),
    [mailboxes]
  );

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="anim-slide fixed bottom-4 right-6 z-40 flex items-center gap-2 rounded-xl border border-edge bg-elev px-4 py-2.5 text-sm shadow-2xl hover:bg-elev2"
      >
        <Send className="h-3.5 w-3.5 text-accent" />
        {subject || "New message"}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "anim-slide fixed bottom-0 right-6 z-40 flex max-h-[85vh] w-[620px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-edge bg-panel shadow-2xl",
        dragOver && "ring-2 ring-accent"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {/* Title bar */}
      <div className="flex h-10 shrink-0 items-center justify-between bg-elev px-3">
        <span className="text-[13px] font-medium">
          {seed.replyToMessageId ? "Reply" : "New message"}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton label="Minimize" onClick={() => setMinimized(true)}>
            <Minus className="h-4 w-4" />
          </IconButton>
          <IconButton label="Close (saves draft)" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {/* From */}
      <div className="flex items-center gap-2 border-b border-edge-soft px-3 py-1.5">
        <span className="w-8 text-xs text-mut2">From</span>
        <select
          value={mailboxId}
          onChange={(e) => {
            setMailboxId(e.target.value);
            markDirty();
          }}
          className="flex-1 cursor-pointer appearance-none bg-transparent text-[13px] outline-none"
        >
          {mailboxOptions.map((m) => (
            <option key={m.id} value={m.id} className="bg-elev text-ink">
              {m.displayName ? `${m.displayName} <${m.email}>` : m.email}
            </option>
          ))}
        </select>
        <button
          className="text-xs text-mut2 hover:text-ink"
          onClick={() => setShowCc((v) => !v)}
        >
          Cc
        </button>
        <button
          className="text-xs text-mut2 hover:text-ink"
          onClick={() => setShowBcc((v) => !v)}
        >
          Bcc
        </button>
      </div>

      <AddressInput label="To" value={to} onChange={(v) => { setTo(v); markDirty(); }} autoFocus={!seed.to?.length} />
      {showCc && <AddressInput label="Cc" value={cc} onChange={(v) => { setCc(v); markDirty(); }} />}
      {showBcc && <AddressInput label="Bcc" value={bcc} onChange={(v) => { setBcc(v); markDirty(); }} />}

      {/* Subject */}
      <div className="flex items-center gap-1 border-b border-edge-soft px-3">
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            markDirty();
          }}
          placeholder="Subject"
          className="h-9 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-mut2"
        />
        <IconButton
          label="AI: generate subject"
          onClick={() => runAi("subject")}
          className={aiBusy === "subject" ? "animate-pulse text-accent" : ""}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-edge-soft px-2 py-1">
        {mode === "rich" && editor && (
          <>
            <IconButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              <List className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              <ListOrdered className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
              <Quote className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Code" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
              <Code className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Link"
              active={editor.isActive("link")}
              onClick={() => {
                const url = prompt("Link URL:", "https://");
                if (url) editor.chain().focus().setLink({ href: url }).run();
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </IconButton>
          </>
        )}
        <div className="mx-1 h-4 w-px bg-edge" />
        <button
          onClick={switchMode}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-mut transition hover:bg-elev2 hover:text-ink"
        >
          {mode === "rich" ? "Markdown" : "Rich text"}
        </button>
        <div className="flex-1" />
        <IconButton
          label="AI: rewrite"
          onClick={() => runAi("rewrite")}
          className={aiBusy === "rewrite" ? "animate-pulse text-accent" : ""}
        >
          <Wand2 className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label="AI: translate"
          onClick={() => runAi("translate")}
          className={aiBusy === "translate" ? "animate-pulse text-accent" : ""}
        >
          <Languages className="h-3.5 w-3.5" />
        </IconButton>
        {templates.length > 0 && (
          <Menu
            trigger={
              <IconButton label="Templates">
                <FileText className="h-3.5 w-3.5" />
              </IconButton>
            }
          >
            {templates.map((tpl) => (
              <MenuItem
                key={tpl.id}
                onClick={() => {
                  if (tpl.subject && !subject) setSubject(tpl.subject);
                  if (mode === "markdown") setMarkdown((m) => m + "\n" + tpl.bodyHtml);
                  else editor?.commands.insertContent(tpl.bodyHtml);
                  markDirty();
                }}
              >
                {tpl.name}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>

      {/* Body */}
      <div className="min-h-40 flex-1 overflow-y-auto">
        {mode === "rich" ? (
          <EditorContent editor={editor} />
        ) : (
          <textarea
            value={markdown}
            onChange={(e) => {
              setMarkdown(e.target.value);
              markDirty();
            }}
            placeholder="Write markdown…"
            className="h-full min-h-40 w-full resize-none bg-transparent px-4 py-3 font-mono text-[12.5px] outline-none placeholder:text-mut2"
          />
        )}
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-edge-soft px-3 py-2">
          {attachments.map((a) => (
            <span
              key={a.storageKey}
              className="flex items-center gap-1.5 rounded-lg border border-edge bg-elev px-2 py-1 text-xs"
            >
              <Paperclip className="h-3 w-3 text-mut2" />
              {a.filename}
              <span className="text-mut2">{formatBytes(a.sizeBytes)}</span>
              <button
                className="text-mut2 hover:text-danger"
                onClick={() => {
                  setAttachments((prev) => prev.filter((x) => x.storageKey !== a.storageKey));
                  markDirty();
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Schedule picker */}
      {scheduleOpen && (
        <div className="flex items-center gap-2 border-t border-edge-soft px-3 py-2">
          <CalendarClock className="h-3.5 w-3.5 text-mut2" />
          <input
            type="datetime-local"
            value={scheduleAt}
            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="rounded-lg border border-edge bg-elev px-2 py-1 text-xs outline-none focus:border-accent"
          />
          {scheduleAt && (
            <button className="text-xs text-mut2 hover:text-ink" onClick={() => setScheduleAt("")}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-1.5 border-t border-edge-soft bg-elev/50 px-3 py-2.5">
        <div className="flex overflow-hidden rounded-lg">
          <Button variant="primary" onClick={send} busy={sending} className="rounded-r-none">
            <Send className="h-3.5 w-3.5" />
            {scheduleAt ? "Schedule" : "Send"}
          </Button>
          <button
            onClick={() => setScheduleOpen((v) => !v)}
            className="flex items-center border-l border-white/20 bg-accent px-1.5 text-white transition hover:bg-accent-hover"
            title="Schedule send"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <label className="cursor-pointer">
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
          />
          <span
            className={cn(
              "flex h-8.5 w-8.5 items-center justify-center rounded-lg text-mut transition hover:bg-elev2 hover:text-ink",
              uploading && "animate-pulse text-accent"
            )}
          >
            <Paperclip className="h-4 w-4" />
          </span>
        </label>
        <span className="text-[11px] text-mut2">
          {uploading ? "Uploading…" : dragOver ? "Drop to attach" : draftId ? "Draft saved" : ""}
        </span>
        <div className="flex-1" />
        <IconButton label="Discard draft" onClick={discard}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

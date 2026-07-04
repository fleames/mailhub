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
import { cn, formatBytes, htmlToText } from "@/lib/utils";
import { api } from "@/lib/client/api";
import type { Address, Contact, Signature, Template, UploadedAttachment } from "@/lib/client/types";
import { useShell } from "./shell";
import { Button, IconButton } from "./ui";

type Range = { from: number; to: number };

function filterTemplates(templates: Template[], query: string): Template[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      (t.shortcut ?? "").toLowerCase().includes(q)
  );
}

/** Ranked match for the slash-command popup: exact/prefix shortcut beats a name substring. */
function rankTemplatesForSlash(templates: Template[], query: string): Template[] {
  const q = query.toLowerCase();
  return templates
    .map((t) => {
      const shortcut = (t.shortcut ?? "").toLowerCase();
      const name = t.name.toLowerCase();
      let score = -1;
      if (q === "") score = 0;
      else if (shortcut === q) score = 3;
      else if (shortcut.startsWith(q)) score = 2;
      else if (name.includes(q)) score = 1;
      return { t, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.t);
}

/** Caret pixel position in a plain textarea, via the standard mirror-div technique. */
function getTextareaCaretPosition(el: HTMLTextAreaElement): { top: number; left: number } {
  const div = document.createElement("div");
  const style = window.getComputedStyle(el);
  const props: (keyof CSSStyleDeclaration)[] = [
    "boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight",
    "fontSize", "lineHeight", "fontFamily", "textAlign", "textIndent", "letterSpacing", "wordSpacing",
    "whiteSpace", "wordWrap", "wordBreak",
  ];
  for (const p of props) {
    // @ts-expect-error dynamic style prop copy
    div.style[p] = style[p];
  }
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  document.body.appendChild(div);
  const cursor = el.selectionStart ?? el.value.length;
  div.textContent = el.value.substring(0, cursor);
  const span = document.createElement("span");
  span.textContent = el.value.substring(cursor) || ".";
  div.appendChild(span);
  const rect = el.getBoundingClientRect();
  const top = rect.top + span.offsetTop - el.scrollTop;
  const left = rect.left + span.offsetLeft - el.scrollLeft;
  document.body.removeChild(div);
  return { top, left };
}

/* ---------- Template picker (search + category groups) ---------- */

function TemplatePickerButton({
  templates,
  onPick,
}: {
  templates: Template[];
  onPick: (tpl: Template) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = filterTemplates(templates, query);
  const byCategory = new Map<string, Template[]>();
  for (const tpl of filtered) {
    const key = tpl.category.trim() || "Uncategorized";
    byCategory.set(key, [...(byCategory.get(key) ?? []), tpl]);
  }

  return (
    <div ref={ref} className="relative">
      <IconButton label="Templates" onClick={() => setOpen((v) => !v)}>
        <FileText className="h-3.5 w-3.5" />
      </IconButton>
      {open && (
        <div className="anim-pop absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-xl border border-edge bg-elev shadow-2xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            className="w-full border-b border-edge-soft bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-mut2"
          />
          <div className="max-h-64 overflow-y-auto py-1">
            {[...byCategory.entries()].map(([cat, items]) => (
              <div key={cat}>
                <div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-mut2">
                  {cat}
                </div>
                {items.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      onPick(tpl);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-elev2"
                  >
                    <span className="truncate">{tpl.name}</span>
                    {tpl.shortcut && (
                      <span className="ml-auto shrink-0 text-[10.5px] text-mut2">/{tpl.shortcut}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-mut2">No matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale suggestions when the input empties or loses focus
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { items } = await api<{ items: Contact[] }>(
          `/api/contacts?q=${encodeURIComponent(text.trim())}&limit=5`
        );
        setSuggestions(items.filter((c) => !value.some((a) => a.email === c.email)));
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

  // Slash-command inline template expansion (both rich and markdown modes).
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashRange, setSlashRange] = useState<Range | null>(null);
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const slashResults = useMemo(
    () => rankTemplatesForSlash(templates, slashQuery),
    [templates, slashQuery]
  );
  // TipTap's editorProps are captured once at editor creation — read live values via refs.
  const templatesRef = useRef<Template[]>([]);
  const slashStateRef = useRef({ open: false, results: [] as Template[], index: 0, range: null as Range | null });
  const applyTemplateRef = useRef<(tpl: Template, range?: Range) => void>(() => {});
  const sendRef = useRef<() => void>(() => {});
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);
  useEffect(() => {
    slashStateRef.current = { open: slashOpen, results: slashResults, index: slashIndex, range: slashRange };
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting highlighted index when the slash query changes
    setSlashIndex(0);
  }, [slashQuery]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write your email… (type / for a template)" }),
    ],
    content: seed.html ?? "",
    editorProps: {
      attributes: { class: "tiptap px-4 py-3 text-[13.5px]" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          sendRef.current();
          return true;
        }
        const s = slashStateRef.current;
        if (!s.open || s.results.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSlashIndex((i) => Math.min(i + 1, s.results.length - 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSlashIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const tpl = s.results[s.index];
          if (tpl) applyTemplateRef.current(tpl, s.range ?? undefined);
          return true;
        }
        if (event.key === "Escape") {
          setSlashOpen(false);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      dirty.current = true;
      if (templatesRef.current.length === 0) {
        setSlashOpen(false);
        return;
      }
      const { from } = ed.state.selection;
      const blockStart = ed.state.selection.$from.start();
      const textBefore = ed.state.doc.textBetween(blockStart, from, "\n", "\n");
      const match = /(?:^|\s)\/([a-zA-Z0-9-]{0,20})$/.exec(textBefore);
      if (match) {
        const query = match[1];
        const slashStart = blockStart + (textBefore.length - query.length - 1);
        setSlashQuery(query);
        setSlashRange({ from: slashStart, to: from });
        const coords = ed.view.coordsAtPos(from);
        setSlashPos({ top: coords.bottom + 6, left: coords.left });
        setSlashOpen(true);
      } else {
        setSlashOpen(false);
        setSlashRange(null);
      }
    },
  });

  // Default mailbox + metadata
  useEffect(() => {
    void api<Template[]>("/api/templates").then(setTemplates).catch(() => {});
    void api<Signature[]>("/api/signatures").then(setSignatures).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mailboxId && mailboxes.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default once mailboxes load async; mailboxId is a real controlled value the <select> can override afterward
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

  const markDirty = () => {
    dirty.current = true;
  };

  // Frozen at mount — a floor to block scheduling into the past, not a live clock.
  // eslint-disable-next-line react-hooks/purity -- Date.now() runs once to compute a static min bound, not a reactive value
  const minScheduleAt = useMemo(() => new Date(Date.now() + 60000).toISOString().slice(0, 16), []);

  /** Insert a template — at the given range (slash command) or at the cursor/end (picker button). */
  const applyTemplate = useCallback(
    (tpl: Template, range?: Range) => {
      if (tpl.subject && !subject) setSubject(tpl.subject);
      if (mode === "markdown") {
        const plain = htmlToText(tpl.bodyHtml);
        if (range) {
          setMarkdown((prev) => prev.slice(0, range.from) + plain + prev.slice(range.to));
        } else {
          setMarkdown((prev) => (prev ? `${prev}\n${plain}` : plain));
        }
      } else if (editor) {
        const chain = editor.chain().focus();
        if (range) chain.deleteRange(range);
        chain.insertContent(tpl.bodyHtml).run();
      }
      setSlashOpen(false);
      setSlashRange(null);
      markDirty();
    },
    [mode, subject, editor]
  );
  useEffect(() => {
    applyTemplateRef.current = applyTemplate;
  });

  function checkSlashMarkdown(el: HTMLTextAreaElement, value: string) {
    if (templates.length === 0) {
      setSlashOpen(false);
      return;
    }
    const cursor = el.selectionStart ?? value.length;
    const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
    const textBefore = value.slice(lineStart, cursor);
    const match = /(?:^|\s)\/([a-zA-Z0-9-]{0,20})$/.exec(textBefore);
    if (match) {
      const query = match[1];
      const slashStart = lineStart + (textBefore.length - query.length - 1);
      setSlashQuery(query);
      setSlashRange({ from: slashStart, to: cursor });
      const pos = getTextareaCaretPosition(el);
      setSlashPos({ top: pos.top + 20, left: pos.left });
      setSlashOpen(true);
    } else {
      setSlashOpen(false);
      setSlashRange(null);
    }
  }

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
  useEffect(() => {
    sendRef.current = send;
  });

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
          <TemplatePickerButton templates={templates} onPick={(tpl) => applyTemplate(tpl)} />
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
              checkSlashMarkdown(e.target, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
                return;
              }
              if (!slashOpen || slashResults.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => Math.min(i + 1, slashResults.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const tpl = slashResults[slashIndex];
                if (tpl && slashRange) applyTemplate(tpl, slashRange);
              } else if (e.key === "Escape") {
                setSlashOpen(false);
              }
            }}
            placeholder="Write markdown… (type / for a template)"
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
            min={minScheduleAt}
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
          <Button
            variant="primary"
            onClick={send}
            busy={sending}
            className="rounded-r-none"
            title={scheduleAt ? undefined : "⌘Enter"}
          >
            <Send className="h-3.5 w-3.5" />
            {scheduleAt ? "Schedule" : "Send"}
            {!scheduleAt && <span className="kbd ml-1 border-white/20 bg-white/10 text-white/70">⌘⏎</span>}
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

      {slashOpen && slashPos && slashResults.length > 0 && (
        <div
          className="anim-pop fixed z-50 w-56 overflow-hidden rounded-lg border border-edge bg-elev shadow-2xl"
          style={{ top: slashPos.top, left: slashPos.left }}
        >
          {slashResults.map((tpl, i) => (
            <button
              key={tpl.id}
              onMouseDown={(e) => {
                e.preventDefault();
                if (slashRange) applyTemplate(tpl, slashRange);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                i === slashIndex ? "bg-accent-soft" : "hover:bg-elev2"
              )}
            >
              <span className="truncate">{tpl.name}</span>
              {tpl.shortcut && (
                <span className="ml-auto shrink-0 text-[10.5px] text-mut2">/{tpl.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

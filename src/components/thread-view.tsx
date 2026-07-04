"use client";

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Trash2,
  Star,
  ShieldAlert,
  Clock,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Forward,
  Sparkles,
  Download,
  ShieldQuestion,
  Tag as TagIcon,
  StickyNote,
  ChevronDown,
  Paperclip,
  AlarmClock,
  CheckCheck,
  AlertTriangle,
  Loader2,
  CalendarClock,
  Undo2,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { timeAgo, useApi, useSse } from "@/lib/client/hooks";
import type { Address, Attachment, Message, Thread } from "@/lib/client/types";
import { useShell } from "./shell";
import { Avatar, Badge, Button, IconButton, Menu, MenuItem, Spinner, Textarea } from "./ui";
import { MessageBody } from "./message-body";
import { AttachmentViewer, attachmentIcon } from "./attachment-viewer";

const STATUS_LABELS: Record<string, { label: string; tone: "mut" | "success" | "danger" | "warning" }> = {
  queued: { label: "Queued", tone: "warning" },
  sending: { label: "Sending…", tone: "warning" },
  sent: { label: "Sent", tone: "mut" },
  delivered: { label: "Delivered", tone: "success" },
  bounced: { label: "Bounced", tone: "danger" },
  complained: { label: "Marked as spam", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  ingest_failed: { label: "Ingest failed", tone: "danger" },
};

function StatusChip({ m }: { m: Message }) {
  if (m.direction === "inbound" && m.status !== "ingest_failed") return null;
  const info = STATUS_LABELS[m.status];
  if (!info) return null;
  const isScheduled = m.status === "queued" && m.scheduledAt && new Date(m.scheduledAt) > new Date();
  const color =
    info.tone === "success" ? "var(--success)" :
    info.tone === "danger" ? "var(--danger)" :
    info.tone === "warning" ? "var(--warning)" : undefined;
  return (
    <Badge color={color}>
      {m.status === "delivered" && <CheckCheck className="h-3 w-3" />}
      {(m.status === "bounced" || m.status === "failed") && <AlertTriangle className="h-3 w-3" />}
      {isScheduled && <CalendarClock className="h-3 w-3" />}
      {isScheduled ? `Scheduled · ${new Date(m.scheduledAt!).toLocaleString()}` : info.label}
    </Badge>
  );
}

function addrLine(list: Address[]): string {
  return list.map((a) => a.name || a.email).join(", ");
}

function MessageCard({
  m,
  expanded,
  onToggle,
  onReply,
  onForward,
  onPreview,
}: {
  m: Message;
  expanded: boolean;
  onToggle: () => void;
  onReply: (all: boolean) => void;
  onForward: () => void;
  onPreview: (a: Attachment) => void;
}) {
  const [phishBusy, setPhishBusy] = useState(false);
  const from = m.fromName || m.fromEmail;

  async function checkPhishing() {
    setPhishBusy(true);
    try {
      const res = await api<{ verdict: string; confidence: number; reasons: string[] }>(
        "/api/ai/phishing",
        { method: "POST", json: { messageId: m.id } }
      );
      const emoji = res.verdict === "safe" ? "✅" : res.verdict === "suspicious" ? "⚠️" : "🚨";
      toast(`${emoji} ${res.verdict.toUpperCase()} (${res.confidence}% confidence)`, {
        description: res.reasons.slice(0, 3).join(" · "),
        duration: 9000,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check failed");
    } finally {
      setPhishBusy(false);
    }
  }

  async function undoSend() {
    try {
      await api(`/api/messages/${m.id}/undo`, { method: "POST" });
      toast.success("Send canceled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Too late to undo");
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-xl border border-edge-soft bg-panel px-4 py-2.5 text-left transition hover:border-edge"
      >
        <Avatar name={from} size={28} />
        <span className="w-40 truncate text-[13px] font-medium">{from}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-mut2">{m.snippet}</span>
        {m.attachments.length > 0 && <Paperclip className="h-3 w-3 shrink-0 text-mut2" />}
        <StatusChip m={m} />
        <span className="shrink-0 text-[11px] text-mut2">{timeAgo(m.date)}</span>
      </button>
    );
  }

  return (
    <div className="anim-fade rounded-xl border border-edge-soft bg-panel">
      <div className="flex items-start gap-3 px-4 pb-2 pt-3.5">
        <Avatar name={from} size={34} />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onToggle}>
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold">{from}</span>
            <span className="truncate text-xs text-mut2">&lt;{m.fromEmail}&gt;</span>
            <StatusChip m={m} />
            {m.spamScore != null && m.spamScore >= 3 && m.direction === "inbound" && (
              <Badge color="var(--warning)">
                <ShieldAlert className="h-3 w-3" /> spam score {m.spamScore}/10
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-mut2">
            to {addrLine(m.toJson)}
            {m.ccJson.length > 0 && ` · cc ${addrLine(m.ccJson)}`}
          </p>
          {m.error && <p className="mt-0.5 text-xs text-danger">{m.error}</p>}
        </div>
        <span className="shrink-0 pt-1 text-[11px] text-mut2">
          {new Date(m.date).toLocaleString()}
        </span>
        <div className="flex shrink-0 items-center">
          <IconButton label="Reply" onClick={() => onReply(false)}>
            <Reply className="h-3.5 w-3.5" />
          </IconButton>
          <Menu
            trigger={
              <IconButton label="More">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </IconButton>
            }
          >
            <MenuItem onClick={() => onReply(true)}>
              <ReplyAll className="h-3.5 w-3.5" /> Reply all
            </MenuItem>
            <MenuItem onClick={onForward}>
              <Forward className="h-3.5 w-3.5" /> Forward
            </MenuItem>
            {m.status === "queued" && (
              <MenuItem onClick={undoSend}>
                <Undo2 className="h-3.5 w-3.5" /> Cancel send
              </MenuItem>
            )}
            <MenuItem onClick={() => window.open(`/api/messages/${m.id}/raw`, "_blank")}>
              <Download className="h-3.5 w-3.5" /> Download original (.eml)
            </MenuItem>
            {m.direction === "inbound" && (
              <MenuItem onClick={checkPhishing}>
                {phishBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldQuestion className="h-3.5 w-3.5" />
                )}
                AI phishing check
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>

      <div className="px-4 pb-4">
        <MessageBody message={m} />
        {m.attachments.filter((a) => !a.isInline).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.attachments
              .filter((a) => !a.isInline)
              .map((a) => {
                const Icon = attachmentIcon(a.contentType);
                return (
                  <button
                    key={a.id}
                    onClick={() => onPreview(a)}
                    className="flex items-center gap-2 rounded-lg border border-edge bg-elev px-2.5 py-1.5 text-xs transition hover:border-accent"
                  >
                    <Icon className="h-3.5 w-3.5 text-mut" />
                    <span className="max-w-44 truncate">{a.filename}</span>
                    <span className="text-mut2">{formatBytes(a.sizeBytes)}</span>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Thread view ---------- */

export function ThreadView({
  conversationId,
  onChanged,
  onClose,
}: {
  conversationId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { tags: allTags, openCompose, mailboxes } = useShell();
  const { data: thread, loading, refresh, setData } = useApi<Thread>(
    `/api/conversations/${conversationId}`
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<{ tone: string; text: string }[] | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");

  useSse(
    (_type, data) => {
      if (data.conversationId === conversationId) void refresh();
    },
    ["message.new", "message.sent", "message.status", "conversation.updated", "message.undone"]
  );

  // Expand the last message when the thread loads; mark read.
  useEffect(() => {
    if (!thread) return;
    setExpanded(new Set([thread.messages[thread.messages.length - 1]?.id].filter(Boolean) as string[]));
    setNotes(thread.internalNotes ?? "");
    setSuggestions(null);
    if (thread.unreadCount > 0) {
      void api(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        json: { read: true },
      }).then(() => onChanged());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.messageCount]);

  const myEmails = useMemo(
    () => new Set(mailboxes.map((m) => m.email ?? "")),
    [mailboxes]
  );

  if (loading && !thread) return <Spinner className="h-full" />;
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-mut2">
        Conversation not found.
      </div>
    );
  }

  async function patch(json: Record<string, unknown>, note?: string) {
    await api(`/api/conversations/${conversationId}`, { method: "PATCH", json });
    void refresh();
    onChanged();
    if (note) toast(note);
  }

  function quoteHtml(m: Message): string {
    const original = m.htmlBody
      ? DOMPurify.sanitize(m.htmlBody, { FORBID_TAGS: ["script", "style", "iframe", "form"] })
      : `<pre>${(m.textBody ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
    return `<p></p><p></p><blockquote>On ${new Date(m.date).toLocaleString()}, ${
      m.fromName || m.fromEmail
    } wrote:<br>${original}</blockquote>`;
  }

  function reply(m: Message, all: boolean, bodyPrefix = "") {
    const replyTo = m.replyTo || m.fromEmail;
    const isMine = m.direction === "outbound";
    const to: Address[] = isMine
      ? m.toJson
      : [{ email: replyTo, name: m.fromName ?? undefined }];
    const cc: Address[] = all
      ? [...m.toJson, ...m.ccJson].filter(
          (a) => !myEmails.has(a.email) && !to.some((t) => t.email === a.email)
        )
      : [];
    openCompose({
      to,
      cc,
      subject: m.subject.match(/^re:/i) ? m.subject : `Re: ${m.subject}`,
      html: `${bodyPrefix}${quoteHtml(m)}`,
      mailboxId: thread?.mailboxId ?? undefined,
      replyToMessageId: m.id,
      conversationId,
    });
  }

  function forward(m: Message) {
    openCompose({
      subject: m.subject.match(/^fwd?:/i) ? m.subject : `Fwd: ${m.subject}`,
      html: `<p></p>${quoteHtml(m)}`,
      mailboxId: thread?.mailboxId ?? undefined,
    });
  }

  async function summarize() {
    setAiBusy(true);
    try {
      const { summary } = await api<{ summary: string }>("/api/ai/summarize", {
        method: "POST",
        json: { conversationId },
      });
      setData({ ...thread!, aiSummary: summary, aiSummaryAt: new Date().toISOString() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setAiBusy(false);
    }
  }

  async function suggestReplies() {
    setSuggestBusy(true);
    try {
      const { replies } = await api<{ replies: { tone: string; text: string }[] }>(
        "/api/ai/reply",
        { method: "POST", json: { conversationId } }
      );
      setSuggestions(replies);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setSuggestBusy(false);
    }
  }

  async function autoTag() {
    try {
      const { applied } = await api<{ applied: string[] }>("/api/ai/autotag", {
        method: "POST",
        json: { conversationId },
      });
      toast(applied.length ? `Tagged: ${applied.join(", ")}` : "No matching tags");
      void refresh();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    }
  }

  const snoozeOptions: { label: string; at: () => Date }[] = [
    { label: "3 hours", at: () => new Date(Date.now() + 3 * 3600_000) },
    {
      label: "Tomorrow 9:00",
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    {
      label: "Next week",
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];

  const last = thread.messages[thread.messages.length - 1];
  const trashed = Boolean(thread.trashedAt);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-edge-soft px-3">
        <IconButton
          label={thread.archivedAt ? "Unarchive" : "Archive (E)"}
          onClick={() => patch({ archived: !thread.archivedAt }, thread.archivedAt ? "Unarchived" : "Archived")}
        >
          {thread.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        </IconButton>
        <IconButton
          label={trashed ? "Restore" : "Trash (#)"}
          onClick={() => patch({ trashed: !trashed }, trashed ? "Restored" : "Moved to trash")}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={thread.isSpam ? "Not spam" : "Mark as spam"}
          active={thread.isSpam}
          onClick={() => patch({ spam: !thread.isSpam }, thread.isSpam ? "Not spam" : "Marked as spam")}
        >
          <ShieldAlert className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Star (S)"
          active={thread.starred}
          onClick={() => patch({ starred: !thread.starred })}
        >
          <Star className="h-4 w-4" fill={thread.starred ? "var(--star)" : "none"} />
        </IconButton>
        <Menu
          trigger={
            <IconButton label="Snooze (H)">
              <Clock className="h-4 w-4" />
            </IconButton>
          }
        >
          {snoozeOptions.map((o) => (
            <MenuItem
              key={o.label}
              onClick={() => patch({ snoozedUntil: o.at().toISOString() }, `Snoozed · ${o.label}`)}
            >
              <Clock className="h-3.5 w-3.5" /> {o.label}
            </MenuItem>
          ))}
          {thread.snoozedUntil && (
            <MenuItem onClick={() => patch({ snoozedUntil: null }, "Unsnoozed")}>
              <Undo2 className="h-3.5 w-3.5" /> Unsnooze
            </MenuItem>
          )}
        </Menu>
        <Menu
          trigger={
            <IconButton label="Tags">
              <TagIcon className="h-4 w-4" />
            </IconButton>
          }
        >
          {allTags.map((tg) => {
            const has = thread.tags.some((x) => x.id === tg.id);
            return (
              <MenuItem
                key={tg.id}
                onClick={async () => {
                  await api(`/api/conversations/${conversationId}/tags`, {
                    method: "POST",
                    json: { tagId: tg.id, add: !has },
                  });
                  void refresh();
                  onChanged();
                }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tg.color }} />
                {tg.name}
                {has && <CheckCheck className="ml-auto h-3.5 w-3.5 text-accent" />}
              </MenuItem>
            );
          })}
          <MenuItem onClick={autoTag}>
            <Sparkles className="h-3.5 w-3.5" /> AI auto-tag
          </MenuItem>
        </Menu>
        <Menu
          trigger={
            <IconButton label="More">
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          }
        >
          <MenuItem onClick={() => patch({ read: false }, "Marked unread")}>
            <ChevronDown className="h-3.5 w-3.5" /> Mark unread
          </MenuItem>
          <MenuItem onClick={() => setNotesOpen((v) => !v)}>
            <StickyNote className="h-3.5 w-3.5" /> Internal notes
          </MenuItem>
          <MenuItem
            onClick={() => {
              const note = prompt("Remind me about this conversation — note:", `Follow up: ${thread.subject}`);
              if (!note) return;
              const at = prompt("When? (YYYY-MM-DD HH:mm)", new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16).replace("T", " "));
              if (!at) return;
              const date = new Date(at.replace(" ", "T"));
              if (isNaN(date.getTime())) return void toast.error("Invalid date");
              void api("/api/reminders", {
                method: "POST",
                json: { conversationId, note, at: date.toISOString() },
              }).then(() => toast.success(`Reminder set for ${date.toLocaleString()}`));
            }}
          >
            <AlarmClock className="h-3.5 w-3.5" /> Follow-up reminder
          </MenuItem>
          {trashed && (
            <MenuItem
              danger
              onClick={async () => {
                if (!confirm("Delete forever? This also removes stored raw email and attachments.")) return;
                await api(`/api/conversations/${conversationId}`, { method: "DELETE" });
                onChanged();
                onClose();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete forever
            </MenuItem>
          )}
        </Menu>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={summarize} busy={aiBusy}>
          <Sparkles className="h-3.5 w-3.5" />
          {thread.aiSummary ? "Re-summarize" : "AI summary"}
        </Button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-3 px-1">
          <div>
            <h1 className="text-[17px] font-semibold leading-snug">
              {thread.subject || "(no subject)"}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {thread.domain && (
                <Badge color={thread.domain.color}>
                  {thread.domain.icon} {thread.domain.name}
                </Badge>
              )}
              {thread.mailbox && thread.domain && (
                <Badge>{thread.mailbox.localPart}@{thread.domain.name}</Badge>
              )}
              {thread.tags.map((tg) => (
                <Badge key={tg.id} color={tg.color}>{tg.name}</Badge>
              ))}
              {thread.snoozedUntil && new Date(thread.snoozedUntil) > new Date() && (
                <Badge color="var(--warning)">
                  <Clock className="h-3 w-3" /> snoozed until {new Date(thread.snoozedUntil).toLocaleString()}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {thread.aiSummary && (
          <div className="anim-fade rounded-xl border border-accent/20 bg-accent-soft px-4 py-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-accent">
              <Sparkles className="h-3.5 w-3.5" /> AI summary
            </div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{thread.aiSummary}</p>
          </div>
        )}

        {notesOpen && (
          <div className="rounded-xl border border-warning/25 bg-warning/5 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning">
              <StickyNote className="h-3.5 w-3.5" /> Internal notes (only you see this)
            </div>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void patch({ internalNotes: notes })}
              placeholder="Notes about this conversation…"
            />
          </div>
        )}

        {thread.messages.map((m) => (
          <MessageCard
            key={m.id}
            m={m}
            expanded={expanded.has(m.id)}
            onToggle={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(m.id)) next.delete(m.id);
                else next.add(m.id);
                return next;
              })
            }
            onReply={(all) => reply(m, all)}
            onForward={() => forward(m)}
            onPreview={setPreview}
          />
        ))}

        {/* Reply bar */}
        {last && (
          <div className="rounded-xl border border-edge-soft bg-panel p-3">
            {suggestions && (
              <div className="mb-2 space-y-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => reply(last, false, `<p>${s.text.replace(/\n/g, "<br>")}</p>`)}
                    className="block w-full rounded-lg border border-edge bg-elev px-3 py-2 text-left text-[13px] transition hover:border-accent"
                  >
                    <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wide text-accent">
                      {s.tone}
                    </span>
                    <span className="line-clamp-3 text-mut">{s.text}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => reply(last, false)}>
                <Reply className="h-3.5 w-3.5" /> Reply
              </Button>
              <Button size="sm" onClick={() => reply(last, true)}>
                <ReplyAll className="h-3.5 w-3.5" /> Reply all
              </Button>
              <Button size="sm" onClick={() => forward(last)}>
                <Forward className="h-3.5 w-3.5" /> Forward
              </Button>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={suggestReplies} busy={suggestBusy}>
                <Sparkles className="h-3.5 w-3.5" /> Suggest replies
              </Button>
            </div>
          </div>
        )}
      </div>

      {preview && <AttachmentViewer attachment={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

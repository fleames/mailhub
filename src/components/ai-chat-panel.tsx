"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { toast } from "sonner";
import { Sparkles, Minus, X, Send, Trash2, Loader2, Copy, Mail } from "lucide-react";
import { cn, htmlToText } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useShell } from "./shell";
import { IconButton } from "./ui";

type ChatTurn = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "mh_ai_chat_history";

function loadHistory(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatTurn[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(turns: ChatTurn[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-60)));
  } catch {}
}

/** Splits a leading "Subject: ..." line (plain or **bold**) from the rest of a draft. */
function splitSubjectLine(raw: string): { subject: string | null; body: string } {
  const lines = raw.split("\n");
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const match = /^\*{0,2}subject\*{0,2}\s*:\s*(.+)$/i.exec(lines[i].trim());
    if (match) {
      let rest = lines.slice(i + 1);
      while (rest.length && (rest[0].trim() === "" || /^-{3,}$/.test(rest[0].trim()))) {
        rest = rest.slice(1);
      }
      return { subject: match[1].trim(), body: rest.join("\n").trim() };
    }
  }
  return { subject: null, body: raw };
}

function markdownToSafeHtml(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string, {
    FORBID_TAGS: ["script", "style", "iframe", "form"],
  });
}

function AssistantBubble({ content }: { content: string }) {
  const { openCompose } = useShell();
  const html = markdownToSafeHtml(content);

  function useInEmail() {
    const { subject, body } = splitSubjectLine(content);
    openCompose({ subject: subject ?? undefined, html: markdownToSafeHtml(body) });
    toast.success("Opened in a new message");
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(htmlToText(html));
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — clipboard access denied");
    }
  }

  return (
    <div className="group max-w-[85%]">
      <div
        className="ai-chat-md rounded-2xl rounded-bl-sm bg-elev px-3.5 py-2.5 text-[13px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="mt-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={copyText}
          title="Copy"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-mut2 transition hover:bg-elev2 hover:text-ink"
        >
          <Copy className="h-3 w-3" /> Copy
        </button>
        <button
          onClick={useInEmail}
          title="Open in a new message"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-mut2 transition hover:bg-elev2 hover:text-ink"
        >
          <Mail className="h-3 w-3" /> Use in email
        </button>
      </div>
    </div>
  );
}

export function AiChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: settings } = useApi<{ ai_model?: string; _env?: { aiModel: string } }>(
    open ? "/api/settings" : null
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage (an external system) when the panel opens
    if (open) setMessages(loadHistory());
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (open && !minimized) textareaRef.current?.focus();
  }, [open, minimized]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    saveHistory(next);
    setInput("");
    setBusy(true);
    try {
      const { reply } = await api<{ reply: string }>("/api/ai/chat", {
        method: "POST",
        json: { messages: next },
      });
      const withReply = [...next, { role: "assistant" as const, content: reply }];
      setMessages(withReply);
      saveHistory(withReply);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI request failed");
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([]);
    saveHistory([]);
  }

  if (!open) return null;

  const modelName = settings?.ai_model || settings?._env?.aiModel;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="anim-slide fixed bottom-4 left-6 z-40 flex items-center gap-2 rounded-xl border border-edge bg-elev px-4 py-2.5 text-sm shadow-2xl hover:bg-elev2"
      >
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        AI Chat
      </button>
    );
  }

  return (
    <div className="anim-slide fixed bottom-0 left-6 z-40 flex h-[70vh] max-h-[600px] w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-edge bg-panel shadow-2xl">
      <div className="flex h-10 shrink-0 items-center justify-between bg-elev px-3">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          AI Chat
          {modelName && <span className="text-[10.5px] font-normal text-mut2">{modelName}</span>}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton label="Clear chat" onClick={clearChat}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Minimize" onClick={() => setMinimized(true)}>
            <Minus className="h-4 w-4" />
          </IconButton>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-mut2">
            <Sparkles className="h-7 w-7" />
            <p className="text-[13px]">Ask anything — not just about email.</p>
            <p className="text-xs">Chat history stays on this device.</p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <AssistantBubble content={m.content} />
            </div>
          )
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-elev px-3.5 py-2.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-mut" />
              <span className="text-xs text-mut">Thinking…</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-edge-soft p-2.5">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message the AI…"
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-edge bg-elev px-3 py-2 text-[13px] outline-none placeholder:text-mut2 focus:border-accent"
        />
        <button
          onClick={() => void send()}
          disabled={!input.trim() || busy}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

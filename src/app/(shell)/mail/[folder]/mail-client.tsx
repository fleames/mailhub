"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
  Inbox,
  FileText,
  Trash2,
  X,
  Mail,
  MailOpen,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { timeAgo, useApi, useHotkeys, useSse } from "@/lib/client/hooks";
import type { Conversation, Draft } from "@/lib/client/types";
import { ConversationRow, type ConversationRowAction } from "@/components/conversation-list";
import { ThreadView } from "@/components/thread-view";
import { useShell } from "@/components/shell";
import { Button, Checkbox, Spinner } from "@/components/ui";

type BulkAction = "read" | "unread" | "archive" | "trash" | "restore" | "deleteForever";

const FOLDER_TITLES: Record<string, string> = {
  all: "All Inbox",
  unread: "Unread",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  trash: "Trash",
  spam: "Spam",
  starred: "Starred",
  snoozed: "Snoozed",
  scheduled: "Scheduled",
};

export function MailClient({ folder }: { folder: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { domains, tags, refreshMeta, openCompose } = useShell();

  const domainId = params.get("domain");
  const tagId = params.get("tag");
  const q = params.get("q");
  const selectedId = params.get("c");

  const isDrafts = folder === "drafts";

  const listPath = useMemo(() => {
    if (isDrafts) return null;
    const sp = new URLSearchParams({ folder });
    if (domainId) sp.set("domain", domainId);
    if (tagId) sp.set("tag", tagId);
    if (q) sp.set("q", q);
    return `/api/conversations?${sp.toString()}`;
  }, [folder, domainId, tagId, q, isDrafts]);

  const { data, setData, loading, refresh } = useApi<{
    items: Conversation[];
    nextCursor: string | null;
  }>(listPath);
  const { data: drafts, refresh: refreshDrafts } = useApi<Draft[]>(
    isDrafts ? "/api/drafts" : null
  );

  const [focusIdx, setFocusIdx] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => data?.items ?? [], [data]);

  // Cross-folder selections are meaningless — drop them whenever the view changes.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [folder, domainId, tagId, q]);

  const toggleCheck = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(items.map((c) => c.id)));
  }, [items]);

  useSse(
    () => {
      void refresh();
      if (isDrafts) void refreshDrafts();
    },
    ["message.new", "message.sent", "message.undone", "conversation.updated", "conversation.deleted", "conversation.unsnoozed"]
  );

  const select = useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (id) sp.set("c", id);
      else sp.delete("c");
      router.replace(`/mail/${folder}?${sp.toString()}`, { scroll: false });
    },
    [params, router, folder]
  );

  async function loadMore() {
    if (!data?.nextCursor || !listPath) return;
    setLoadingMore(true);
    try {
      const more = await api<{ items: Conversation[]; nextCursor: string | null }>(
        `${listPath}&cursor=${encodeURIComponent(data.nextCursor)}`
      );
      setData({ items: [...items, ...more.items], nextCursor: more.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  }

  const act = useCallback(
    async (conv: Conversation, action: ConversationRowAction) => {
      if (action === "deleteForever") {
        if (
          !confirm(
            `Delete "${conv.subject || "(no subject)"}" forever? This also removes stored raw email and attachments.`
          )
        ) {
          return;
        }
        await api(`/api/conversations/${conv.id}`, { method: "DELETE" });
        void refresh();
        refreshMeta();
        if (selectedId === conv.id) select(null);
        return;
      }

      const json =
        action === "star"
          ? { starred: !conv.starred }
          : action === "archive"
            ? { archived: !conv.archivedAt }
            : action === "restore"
              ? { trashed: false }
              : action === "trash"
                ? { trashed: true }
                : { read: conv.unreadCount > 0 };
      await api(`/api/conversations/${conv.id}`, { method: "PATCH", json });
      void refresh();
      refreshMeta();
      if ((action === "archive" || action === "trash" || action === "restore") && selectedId === conv.id) {
        select(null);
      }
    },
    [refresh, refreshMeta, select, selectedId]
  );

  const bulkAct = useCallback(
    async (action: BulkAction) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      if (
        action === "deleteForever" &&
        !confirm(
          `Permanently delete ${ids.length} conversation${ids.length === 1 ? "" : "s"}? This also removes stored raw email and attachments. This cannot be undone.`
        )
      ) {
        return;
      }

      setBulkBusy(true);
      try {
        const results = await Promise.allSettled(
          ids.map((id) =>
            action === "deleteForever"
              ? api(`/api/conversations/${id}`, { method: "DELETE" })
              : api(`/api/conversations/${id}`, {
                  method: "PATCH",
                  json:
                    action === "read"
                      ? { read: true }
                      : action === "unread"
                        ? { read: false }
                        : action === "archive"
                          ? { archived: true }
                          : action === "restore"
                            ? { trashed: false }
                            : { trashed: true },
                })
          )
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          toast.error(`${failed} of ${ids.length} failed`);
        } else {
          toast.success(`${ids.length} conversation${ids.length === 1 ? "" : "s"} updated`);
        }
      } finally {
        setBulkBusy(false);
      }

      if (selectedId && ids.includes(selectedId)) select(null);
      clearSelection();
      void refresh();
      refreshMeta();
    },
    [selectedIds, selectedId, select, clearSelection, refresh, refreshMeta]
  );

  // Keyboard navigation
  useHotkeys({
    j: () => setFocusIdx((i) => Math.min(i + 1, items.length - 1)),
    k: () => setFocusIdx((i) => Math.max(i - 1, 0)),
    arrowdown: () => setFocusIdx((i) => Math.min(i + 1, items.length - 1)),
    arrowup: () => setFocusIdx((i) => Math.max(i - 1, 0)),
    enter: () => items[focusIdx] && select(items[focusIdx].id),
    o: () => items[focusIdx] && select(items[focusIdx].id),
    e: () => items[focusIdx] && void act(items[focusIdx], "archive"),
    s: () => items[focusIdx] && void act(items[focusIdx], "star"),
    x: () => items[focusIdx] && toggleCheck(items[focusIdx].id),
    "#": () =>
      items[focusIdx] &&
      void act(items[focusIdx], folder === "trash" ? "deleteForever" : "trash"),
    u: () => items[focusIdx] && void act(items[focusIdx], "toggleRead"),
    escape: () => (selectedIds.size > 0 ? clearSelection() : select(null)),
  });

  // Keep focused row in view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-conv-row="${items[focusIdx]?.id}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIdx, items]);

  const title = q
    ? `Search: "${q}"`
    : domainId
      ? domains.find((d) => d.id === domainId)?.name ?? "Domain"
      : tagId
        ? `Tag: ${tags.find((t) => t.id === tagId)?.name ?? ""}`
        : FOLDER_TITLES[folder] ?? folder;

  /* ---------- Drafts folder ---------- */
  if (isDrafts) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge-soft px-4">
          <FileText className="h-4 w-4 text-mut" />
          <h1 className="text-sm font-semibold">Drafts</h1>
          <span className="text-xs text-mut2">{drafts?.length ?? 0}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!drafts && <Spinner />}
          {drafts?.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-mut2">
              <FileText className="h-8 w-8" />
              <p className="text-sm">No drafts</p>
            </div>
          )}
          {drafts?.map((d) => (
            <div
              key={d.id}
              className="group flex cursor-pointer items-center gap-3 border-b border-edge-soft px-4 py-3 transition hover:bg-elev"
              onClick={() =>
                openCompose({
                  draftId: d.id,
                  mailboxId: d.mailboxId ?? undefined,
                  to: d.toJson,
                  cc: d.ccJson,
                  bcc: d.bccJson,
                  subject: d.subject,
                  html: d.bodyHtml,
                  attachments: d.attachmentsJson,
                  replyToMessageId: d.replyToMessageId,
                  conversationId: d.conversationId,
                })
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-danger">Draft</span>
                  <span className="truncate text-[13px]">
                    {d.toJson.map((a) => a.name || a.email).join(", ") || "(no recipients)"}
                  </span>
                  <span className="ml-auto text-[11px] text-mut2">{timeAgo(d.updatedAt)}</span>
                </div>
                <p className="truncate text-[13px] text-mut">{d.subject || "(no subject)"}</p>
                <p className="truncate text-xs text-mut2">
                  {d.bodyHtml.replace(/<[^>]+>/g, " ").slice(0, 140)}
                </p>
              </div>
              <button
                className="hidden rounded-md p-1.5 text-mut transition hover:bg-elev2 hover:text-danger group-hover:block"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api(`/api/drafts/${d.id}`, { method: "DELETE" });
                  void refreshDrafts();
                  refreshMeta();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ---------- Conversation folders ---------- */
  return (
    <PanelGroup direction="horizontal" autoSaveId="mh-mail-panels">
      <Panel defaultSize={38} minSize={26} maxSize={60}>
        <div className="flex h-full flex-col border-r border-edge-soft">
          <div className="flex h-11 shrink-0 items-center gap-3 px-4">
            <Checkbox
              checked={items.length > 0 && selectedIds.size === items.length}
              indeterminate={selectedIds.size > 0 && selectedIds.size < items.length}
              onChange={(v) => (v ? selectAllVisible() : clearSelection())}
            />
            {selectedIds.size > 0 ? (
              <>
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
                <div className="flex items-center gap-1">
                  {folder === "trash" ? (
                    <>
                      <Button size="sm" busy={bulkBusy} onClick={() => void bulkAct("restore")}>
                        <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        busy={bulkBusy}
                        onClick={() => void bulkAct("deleteForever")}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete forever
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" busy={bulkBusy} onClick={() => void bulkAct("read")} title="Mark as read">
                        <MailOpen className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" busy={bulkBusy} onClick={() => void bulkAct("unread")} title="Mark as unread">
                        <Mail className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" busy={bulkBusy} onClick={() => void bulkAct("archive")}>
                        <Archive className="h-3.5 w-3.5" /> Archive
                      </Button>
                      <Button size="sm" variant="danger" busy={bulkBusy} onClick={() => void bulkAct("trash")}>
                        <Trash2 className="h-3.5 w-3.5" /> Trash
                      </Button>
                    </>
                  )}
                </div>
                <button
                  onClick={clearSelection}
                  className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-mut transition hover:bg-elev hover:text-ink"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              </>
            ) : (
              <>
                <h1 className="text-sm font-semibold">{title}</h1>
                <span className="text-xs text-mut2">{items.length}{data?.nextCursor ? "+" : ""}</span>
                {(q || domainId || tagId) && (
                  <button
                    onClick={() => router.push(`/mail/${folder}`)}
                    className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-mut transition hover:bg-elev hover:text-ink"
                  >
                    <X className="h-3 w-3" /> Clear filter
                  </button>
                )}
              </>
            )}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t border-edge-soft">
            {loading && items.length === 0 && <Spinner />}
            {!loading && items.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-mut2">
                <Inbox className="h-8 w-8" />
                <p className="text-sm">Nothing here</p>
              </div>
            )}
            {items.map((conv, i) => (
              <ConversationRow
                key={conv.id}
                conv={conv}
                selected={selectedId === conv.id}
                focused={focusIdx === i}
                inTrash={folder === "trash"}
                checked={selectedIds.has(conv.id)}
                anySelected={selectedIds.size > 0}
                onSelect={() => {
                  setFocusIdx(i);
                  select(conv.id);
                }}
                onAction={(action) => void act(conv, action)}
                onToggleCheck={() => toggleCheck(conv.id)}
              />
            ))}
            {data?.nextCursor && (
              <div className="p-3 text-center">
                <Button size="sm" onClick={loadMore} busy={loadingMore}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        </div>
      </Panel>
      <PanelResizeHandle />
      <Panel minSize={35}>
        {selectedId ? (
          <ThreadView
            key={selectedId}
            conversationId={selectedId}
            onChanged={() => {
              void refresh();
              refreshMeta();
            }}
            onClose={() => select(null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-mut2">
            <Inbox className="h-10 w-10" />
            <p className="text-sm">Select a conversation</p>
            <p className="text-xs">
              <span className="kbd">J</span>/<span className="kbd">K</span> navigate ·{" "}
              <span className="kbd">↵</span> open · <span className="kbd">X</span> select ·{" "}
              <span className="kbd">E</span> archive · <span className="kbd">S</span> star ·{" "}
              <span className="kbd">#</span> trash · <span className="kbd">C</span> compose
            </p>
          </div>
        )}
      </Panel>
    </PanelGroup>
  );
}

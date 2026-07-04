"use client";

import { Paperclip, Star, Archive, ArchiveRestore, Trash2, MailOpen, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/client/hooks";
import type { Conversation } from "@/lib/client/types";
import { Avatar, Badge, Checkbox } from "./ui";

export type ConversationRowAction =
  | "star"
  | "archive"
  | "trash"
  | "toggleRead"
  | "restore"
  | "deleteForever";

export function ConversationRow({
  conv,
  selected,
  focused,
  inTrash,
  checked,
  anySelected,
  onSelect,
  onAction,
  onToggleCheck,
}: {
  conv: Conversation;
  selected: boolean;
  focused: boolean;
  inTrash: boolean;
  checked: boolean;
  anySelected: boolean;
  onSelect: () => void;
  onAction: (action: ConversationRowAction) => void;
  onToggleCheck: () => void;
}) {
  const unread = conv.unreadCount > 0;
  const who =
    conv.participants
      .slice(0, 3)
      .map((p) => (p.name?.split(" ")[0] || p.email.split("@")[0]))
      .join(", ") || "(nobody)";
  const primary = conv.participants[0]?.name || conv.participants[0]?.email || "?";

  return (
    <div
      data-conv-row={conv.id}
      onClick={onSelect}
      className={cn(
        "group relative flex cursor-pointer gap-3 border-b border-edge-soft px-3.5 py-2.5 transition",
        selected ? "bg-accent-soft" : "hover:bg-elev",
        focused && !selected && "bg-elev"
      )}
      style={
        conv.domain
          ? { boxShadow: `inset 2.5px 0 0 ${selected || unread ? conv.domain.color : "transparent"}` }
          : undefined
      }
    >
      <div className="relative h-8.5 w-8.5 shrink-0">
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity",
            checked || anySelected ? "opacity-0" : "opacity-100 group-hover:opacity-0"
          )}
        >
          <Avatar name={primary} size={34} />
        </div>
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity",
            checked || anySelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <Checkbox checked={checked} onChange={onToggleCheck} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("truncate text-[13px]", unread ? "font-semibold text-ink" : "text-mut")}>
            {who}
          </span>
          {conv.messageCount > 1 && (
            <span className="text-[11px] text-mut2">{conv.messageCount}</span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-mut2">
            {timeAgo(conv.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate text-[13px]", unread ? "font-medium text-ink" : "text-mut")}>
            {conv.subject || "(no subject)"}
          </span>
          {conv.attachmentCount > 0 && <Paperclip className="h-3 w-3 shrink-0 text-mut2" />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-xs text-mut2">{conv.snippet}</span>
        </div>
        <div className="mt-1 flex items-center gap-1">
          {conv.domain && (
            <Badge color={conv.domain.color}>
              {conv.domain.icon} {conv.domain.name}
            </Badge>
          )}
          {conv.mailbox && conv.domain && (
            <Badge>{conv.mailbox.localPart}@</Badge>
          )}
          {conv.tags.map((tg) => (
            <Badge key={tg.id} color={tg.color}>
              {tg.name}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-end justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction("star");
          }}
          className={cn(
            "transition",
            conv.starred ? "text-star" : "text-mut2 opacity-0 hover:text-star group-hover:opacity-100"
          )}
        >
          <Star className="h-3.5 w-3.5" fill={conv.starred ? "currentColor" : "none"} />
        </button>
        {unread && <span className="h-2 w-2 rounded-full bg-accent" />}
      </div>

      {/* Hover quick actions */}
      <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-edge bg-elev p-0.5 shadow-lg group-hover:flex">
        <button
          title={unread ? "Mark read" : "Mark unread"}
          className="rounded-md p-1.5 text-mut transition hover:bg-elev2 hover:text-ink"
          onClick={(e) => {
            e.stopPropagation();
            onAction("toggleRead");
          }}
        >
          {unread ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
        </button>
        {inTrash ? (
          <>
            <button
              title="Restore to Inbox"
              className="rounded-md p-1.5 text-mut transition hover:bg-elev2 hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                onAction("restore");
              }}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </button>
            <button
              title="Delete forever"
              className="rounded-md p-1.5 text-mut transition hover:bg-elev2 hover:text-danger"
              onClick={(e) => {
                e.stopPropagation();
                onAction("deleteForever");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              title="Archive (E)"
              className="rounded-md p-1.5 text-mut transition hover:bg-elev2 hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                onAction("archive");
              }}
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
            <button
              title="Trash (#)"
              className="rounded-md p-1.5 text-mut transition hover:bg-elev2 hover:text-danger"
              onClick={(e) => {
                e.stopPropagation();
                onAction("trash");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Inbox,
  MailOpen,
  Send,
  FileText,
  Archive,
  Trash2,
  ShieldAlert,
  Star,
  Clock,
  CalendarClock,
  Globe,
  Users,
  Settings,
  LayoutDashboard,
  Activity,
  TagIcon,
  ChevronRight,
  AtSign,
  Layers,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "./shell";

const FOLDERS = [
  { key: "all", label: "All Inbox", icon: Inbox, countKey: "inbox_unread" },
  { key: "unread", label: "Unread", icon: MailOpen, countKey: "inbox_unread" },
  { key: "starred", label: "Starred", icon: Star },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileText, countKey: "drafts" },
  { key: "scheduled", label: "Scheduled", icon: CalendarClock, countKey: "scheduled" },
  { key: "snoozed", label: "Snoozed", icon: Clock, countKey: "snoozed" },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "spam", label: "Spam", icon: ShieldAlert, countKey: "spam" },
  { key: "trash", label: "Trash", icon: Trash2 },
] as const;

function NavRow({
  href,
  active,
  children,
  count,
  color,
  compact,
  className,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  count?: number;
  color?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition",
        compact ? "h-7" : "h-8",
        active
          ? "bg-accent-soft font-medium text-ink"
          : "text-mut hover:bg-elev hover:text-ink",
        className
      )}
      style={active && color ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}
    >
      {children}
      {count != null && count > 0 && (
        <span className="ml-auto rounded-full bg-elev2 px-1.5 py-px text-[10.5px] font-semibold text-mut">
          {count > 999 ? "999+" : count}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { domains, mailboxes, mailboxGroups, connectedAccounts, tags, counts } = useShell();
  const activeDomain = params.get("domain");
  const activeMailbox = params.get("mailbox");
  const activeLocalPart = params.get("localPart");
  const activeAccount = params.get("account");
  const activeTag = params.get("tag");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const domainUnread = new Map((counts?.domains ?? []).map((d) => [d.id, d.unread]));
  const mailboxUnread = new Map((counts?.mailboxes ?? []).map((m) => [m.id, m.unread]));
  const accountUnread = new Map((counts?.connectedAccounts ?? []).map((a) => [a.id, a.unread]));

  function toggleExpanded(domainId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return next;
    });
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-edge-soft bg-panel">
      <div className="flex h-13 items-center gap-2.5 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Inbox className="h-4 w-4" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">MailHub</span>
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 pb-4">
        <div className="space-y-0.5">
          <NavRow href="/" active={pathname === "/"}>
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </NavRow>
        </div>

        <div className="space-y-0.5">
          {FOLDERS.map((f) => {
            const active =
              pathname === `/mail/${f.key}` &&
              !activeDomain &&
              !activeTag &&
              !activeLocalPart &&
              !activeAccount;
            const count =
              "countKey" in f && f.countKey && counts
                ? (counts[f.countKey as keyof typeof counts] as number)
                : undefined;
            return (
              <NavRow
                key={f.key}
                href={`/mail/${f.key}`}
                active={active}
                count={f.key === "starred" ? undefined : count}
              >
                <f.icon className="h-4 w-4" /> {f.label}
              </NavRow>
            );
          })}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between px-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-mut2">
              Domains
            </span>
            <Link href="/settings?tab=domains" className="text-mut2 transition hover:text-ink">
              <Settings className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-0.5">
            {domains.map((d) => {
              const domainMailboxes = mailboxes.filter((m) => m.domainId === d.id);
              const isExpanded = expanded.has(d.id);
              return (
                <div key={d.id}>
                  <div className="group/domain flex items-center">
                    <button
                      onClick={() => toggleExpanded(d.id)}
                      className={cn(
                        "flex h-8 w-5 shrink-0 items-center justify-center text-mut2 transition hover:text-ink",
                        domainMailboxes.length === 0 && "invisible"
                      )}
                      title={isExpanded ? "Collapse" : "Show mailboxes"}
                    >
                      <ChevronRight
                        className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")}
                      />
                    </button>
                    <NavRow
                      href={`/mail/all?domain=${d.id}`}
                      active={activeDomain === d.id && !activeMailbox && !activeLocalPart}
                      count={domainUnread.get(d.id)}
                      color={d.color}
                      className="min-w-0 flex-1"
                    >
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px]"
                        style={{ color: d.color }}
                      >
                        {d.icon || "●"}
                      </span>
                      <span className="truncate">{d.name}</span>
                    </NavRow>
                  </div>
                  {isExpanded && domainMailboxes.length > 0 && (
                    <div className="ml-5 space-y-0.5 border-l border-edge-soft py-0.5 pl-2">
                      {domainMailboxes.map((mb) => (
                        <NavRow
                          key={mb.id}
                          href={`/mail/all?mailbox=${mb.id}`}
                          active={activeMailbox === mb.id}
                          count={mailboxUnread.get(mb.id)}
                          compact
                        >
                          <AtSign className="h-3 w-3 shrink-0 text-mut2" />
                          <span className="truncate text-[12px]">{mb.localPart}@</span>
                        </NavRow>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {domains.length === 0 && (
              <Link
                href="/settings?tab=setup"
                className="block px-2.5 py-1 text-xs text-accent hover:underline"
              >
                No domains yet — add one →
              </Link>
            )}
          </div>
        </div>

        {mailboxGroups.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between px-2.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-mut2">
                Combined Inboxes
              </span>
              <Layers className="h-3 w-3 text-mut2" />
            </div>
            <div className="space-y-0.5">
              {mailboxGroups.map((g) => (
                <NavRow
                  key={g.localPart}
                  href={`/mail/all?localPart=${encodeURIComponent(g.localPart)}`}
                  active={activeLocalPart === g.localPart}
                  count={g.unread}
                >
                  <Layers className="h-3.5 w-3.5 shrink-0 text-mut2" />
                  <span className="truncate">{g.localPart}@*</span>
                  <span className="ml-1 shrink-0 text-[10.5px] text-mut2">{g.domainCount}</span>
                </NavRow>
              ))}
            </div>
          </div>
        )}

        {connectedAccounts.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between px-2.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-mut2">
                Connected Accounts
              </span>
              <Link href="/settings?tab=accounts" className="text-mut2 transition hover:text-ink">
                <Settings className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-0.5">
              {connectedAccounts.map((acc) => (
                <NavRow
                  key={acc.id}
                  href={`/mail/all?account=${acc.id}`}
                  active={activeAccount === acc.id}
                  count={accountUnread.get(acc.id)}
                >
                  <Plug
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      acc.status === "active" ? "text-mut2" : "text-danger"
                    )}
                  />
                  <span className="truncate">{acc.emailAddress}</span>
                </NavRow>
              ))}
            </div>
          </div>
        )}

        {tags.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between px-2.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-mut2">
                Tags
              </span>
              <Link href="/settings?tab=tags" className="text-mut2 transition hover:text-ink">
                <TagIcon className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-0.5">
              {tags.map((tg) => (
                <NavRow
                  key={tg.id}
                  href={`/mail/all?tag=${tg.id}`}
                  active={activeTag === tg.id}
                  count={tg.conversationCount}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: tg.color }}
                  />
                  <span className="truncate">{tg.name}</span>
                </NavRow>
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-edge-soft p-2.5">
        <NavRow href="/contacts" active={pathname === "/contacts"}>
          <Users className="h-4 w-4" /> Contacts
        </NavRow>
        <NavRow href="/activity" active={pathname === "/activity"}>
          <Activity className="h-4 w-4" /> Activity
        </NavRow>
        <NavRow href="/settings" active={pathname.startsWith("/settings")}>
          <Settings className="h-4 w-4" /> Settings
        </NavRow>
        <div className="px-2.5 pt-1 text-[10px] text-mut2">
          {domains.length} domains · <Globe className="mb-px inline h-2.5 w-2.5" /> self-hosted
        </div>
      </div>
    </aside>
  );
}

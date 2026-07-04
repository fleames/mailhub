"use client";

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
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  count?: number;
  color?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition",
        active
          ? "bg-accent-soft font-medium text-ink"
          : "text-mut hover:bg-elev hover:text-ink"
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
  const { domains, tags, counts } = useShell();
  const activeDomain = params.get("domain");
  const activeTag = params.get("tag");

  const domainUnread = new Map((counts?.domains ?? []).map((d) => [d.id, d.unread]));

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
              pathname === `/mail/${f.key}` && !activeDomain && !activeTag;
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
            {domains.map((d) => (
              <NavRow
                key={d.id}
                href={`/mail/all?domain=${d.id}`}
                active={activeDomain === d.id}
                count={domainUnread.get(d.id)}
                color={d.color}
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded text-[11px]"
                  style={{ color: d.color }}
                >
                  {d.icon || "●"}
                </span>
                <span className="truncate">{d.name}</span>
              </NavRow>
            ))}
            {domains.length === 0 && (
              <p className="px-2.5 py-1 text-xs text-mut2">
                No domains yet — add one in Settings.
              </p>
            )}
          </div>
        </div>

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

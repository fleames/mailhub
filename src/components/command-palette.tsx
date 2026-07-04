"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Inbox,
  Send,
  Star,
  Archive,
  Trash2,
  ShieldAlert,
  PenSquare,
  LayoutDashboard,
  Users,
  Settings,
  Mail,
  Clock,
  FileText,
  CalendarClock,
} from "lucide-react";
import { Avatar } from "./ui";
import { useShell } from "./shell";
import { timeAgo } from "@/lib/client/hooks";

type SearchHit = {
  id: string;
  conversationId: string;
  subject: string;
  snippet: string;
  fromEmail: string;
  fromName: string | null;
  date: string;
  domainName: string | null;
  domainColor: string | null;
  domainIcon: string | null;
};

type ContactHit = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  conversationCount: number;
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { domains, openCompose } = useShell();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [contactHits, setContactHits] = useState<ContactHit[]>([]);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing on close, an external trigger
      setQuery("");
      setHits([]);
      setContactHits([]);
      return;
    }
  }, [open]);

  // Debounced live search
  useEffect(() => {
    if (query.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale results when the query shrinks below the search threshold
      setHits([]);
      setContactHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = (await res.json()) as { messages: SearchHit[]; contacts: ContactHit[] };
          setHits(data.messages.slice(0, 8));
          setContactHits(data.contacts.slice(0, 5));
        }
      } catch {}
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const go = (path: string) => {
    onClose();
    router.push(path);
  };

  if (!open) return null;

  const nav = [
    { label: "All Inbox", icon: Inbox, path: "/mail/all" },
    { label: "Sent", icon: Send, path: "/mail/sent" },
    { label: "Starred", icon: Star, path: "/mail/starred" },
    { label: "Drafts", icon: FileText, path: "/mail/drafts" },
    { label: "Scheduled", icon: CalendarClock, path: "/mail/scheduled" },
    { label: "Snoozed", icon: Clock, path: "/mail/snoozed" },
    { label: "Archive", icon: Archive, path: "/mail/archive" },
    { label: "Spam", icon: ShieldAlert, path: "/mail/spam" },
    { label: "Trash", icon: Trash2, path: "/mail/trash" },
    { label: "Dashboard", icon: LayoutDashboard, path: "/" },
    { label: "Contacts", icon: Users, path: "/contacts" },
    { label: "Settings", icon: Settings, path: "/settings" },
  ];

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <Command
        shouldFilter={query.trim().length < 2}
        className="anim-pop w-[620px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl"
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search mail, jump anywhere, run a command…"
          className="h-12 w-full border-b border-edge-soft bg-transparent px-4 text-sm outline-none placeholder:text-mut2"
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-sm text-mut">
            Nothing found.
          </Command.Empty>

          {hits.length > 0 && (
            <Command.Group
              heading="Mail"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mut2"
            >
              {hits.map((h) => (
                <Command.Item
                  key={h.id}
                  value={`mail-${h.id}`}
                  onSelect={() => go(`/mail/all?c=${h.conversationId}`)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-elev"
                >
                  <Mail className="h-4 w-4 shrink-0 text-mut2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="font-medium">{h.fromName || h.fromEmail}</span>
                      <span className="text-mut"> — {h.subject || "(no subject)"}</span>
                    </span>
                    <span className="block truncate text-xs text-mut2">{h.snippet}</span>
                  </span>
                  {h.domainName && (
                    <span className="text-[10.5px]" style={{ color: h.domainColor ?? undefined }}>
                      {h.domainIcon} {h.domainName}
                    </span>
                  )}
                  <span className="text-[10.5px] text-mut2">{timeAgo(h.date)}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {contactHits.length > 0 && (
            <Command.Group
              heading="Contacts"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mut2"
            >
              {contactHits.map((c) => (
                <Command.Item
                  key={c.id}
                  value={`contact-${c.id}`}
                  onSelect={() => go(`/mail/all?q=${encodeURIComponent(c.email)}`)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-elev"
                >
                  <Avatar name={c.name || c.email} size={24} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{c.name || c.email}</span>
                    {c.name && <span className="text-mut"> — {c.email}</span>}
                    {c.company && <span className="text-mut2"> · {c.company}</span>}
                  </span>
                  <span className="text-[10.5px] text-mut2">{c.conversationCount} convos</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mut2"
          >
            <Command.Item
              value="compose new email"
              onSelect={() => {
                onClose();
                openCompose();
              }}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-elev"
            >
              <PenSquare className="h-4 w-4 text-mut2" /> Compose new email
              <span className="kbd ml-auto">C</span>
            </Command.Item>
          </Command.Group>

          <Command.Group
            heading="Go to"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mut2"
          >
            {nav.map((n) => (
              <Command.Item
                key={n.path}
                value={`go ${n.label}`}
                onSelect={() => go(n.path)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-elev"
              >
                <n.icon className="h-4 w-4 text-mut2" /> {n.label}
              </Command.Item>
            ))}
            {domains.map((d) => (
              <Command.Item
                key={d.id}
                value={`domain ${d.name}`}
                onSelect={() => go(`/mail/all?domain=${d.id}`)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-elev"
              >
                <span style={{ color: d.color }}>{d.icon}</span> {d.name}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

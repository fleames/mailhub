"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MailOpen,
  Inbox,
  Send,
  AlertTriangle,
  CalendarClock,
  Users,
  HardDrive,
  Paperclip,
  Activity,
  Globe,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { timeAgo, useApi, useSse } from "@/lib/client/hooks";
import { Avatar, Spinner } from "@/components/ui";

type Dashboard = {
  stats: {
    unread: number;
    receivedToday: number;
    sentToday: number;
    deliveryFailures: number;
    scheduled: number;
    contacts: number;
    messageBytes: number;
    attachmentBytes: number;
    ingestFailures: number;
  };
  topContacts: { id: string; email: string; name: string | null; messageCount: number }[];
  largestAttachments: {
    id: string;
    filename: string;
    sizeBytes: number;
    subject: string;
    conversationId: string;
  }[];
  domainActivity: { id: string; name: string; color: string; icon: string; last7d: number; total: number }[];
  failures: {
    id: string;
    subject: string;
    fromEmail: string;
    status: string;
    error: string | null;
    conversationId: string;
    date: string;
  }[];
  activity: { id: string; type: string; conversationId: string | null; payload: Record<string, unknown>; createdAt: string }[];
  volume: { day: string; inbound: number; outbound: number }[];
  storageBackend: "r2" | "local";
};

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  href,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  tone?: "danger" | "accent";
}) {
  const inner = (
    <div className="flex h-full flex-col rounded-2xl border border-edge-soft bg-panel p-4 transition hover:border-edge">
      <div className="mb-2 flex items-center gap-2 text-mut">
        <Icon className={tone === "danger" ? "h-4 w-4 text-danger" : "h-4 w-4"} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      {sub && <span className="mt-0.5 text-[11px] text-mut2">{sub}</span>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Card({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-edge-soft bg-panel">
      <div className="flex items-center gap-2 border-b border-edge-soft px-4 py-3">
        <Icon className="h-3.5 w-3.5 text-mut" />
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="min-h-0 flex-1 p-2">{children}</div>
    </div>
  );
}

/** 14-day grouped bar chart, two series, per-mark hover tooltip. */
function VolumeChart({ volume }: { volume: Dashboard["volume"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...volume.map((v) => Math.max(v.inbound, v.outbound)));
  const H = 110;

  return (
    <div className="px-2 pb-1">
      <div className="relative flex items-end gap-1" style={{ height: H + 20 }}>
        {volume.map((v, i) => {
          const hIn = Math.round((v.inbound / max) * H);
          const hOut = Math.round((v.outbound / max) * H);
          const day = new Date(v.day + "T00:00:00");
          return (
            <div
              key={v.day}
              className="group relative flex flex-1 cursor-default flex-col justify-end"
              style={{ height: H + 20 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="flex items-end justify-center gap-[2px]" style={{ height: H }}>
                <div
                  className="w-[38%] max-w-3 rounded-t-[4px] transition-opacity"
                  style={{
                    height: Math.max(hIn, v.inbound > 0 ? 3 : 1),
                    background: v.inbound > 0 ? "var(--chart-inbound)" : "var(--elev2)",
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
                <div
                  className="w-[38%] max-w-3 rounded-t-[4px] transition-opacity"
                  style={{
                    height: Math.max(hOut, v.outbound > 0 ? 3 : 1),
                    background: v.outbound > 0 ? "var(--chart-outbound)" : "var(--elev2)",
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
              </div>
              <span className="mt-1 text-center text-[9px] text-mut2">
                {day.toLocaleDateString(undefined, { day: "numeric" })}
              </span>
              {hover === i && (
                <div className="anim-pop pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-edge bg-elev px-2.5 py-1.5 text-[11px] shadow-xl">
                  <div className="mb-0.5 font-medium">
                    {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-inbound)" }} />
                    Received <span className="ml-auto pl-2 font-semibold">{v.inbound}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-outbound)" }} />
                    Sent <span className="ml-auto pl-2 font-semibold">{v.outbound}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-4 px-1 text-[11px] text-mut">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-inbound)" }} /> Received
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-outbound)" }} /> Sent
        </span>
      </div>
      {/* screen-reader table view */}
      <table className="sr-only">
        <caption>Email volume, last 14 days</caption>
        <thead>
          <tr><th>Day</th><th>Received</th><th>Sent</th></tr>
        </thead>
        <tbody>
          {volume.map((v) => (
            <tr key={v.day}><td>{v.day}</td><td>{v.inbound}</td><td>{v.outbound}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  "message.received": "📥 Received",
  "message.queued": "🕐 Queued",
  "message.sent": "📤 Sent",
  "message.failed": "❌ Send failed",
  "message.send_undone": "↩️ Send undone",
  "delivery.delivered": "✅ Delivered",
  "delivery.bounced": "⛔ Bounced",
  "delivery.complained": "🚫 Spam complaint",
  "conversation.updated": "✏️ Updated",
  "conversation.deleted": "🗑️ Deleted",
  "conversation.unsnoozed": "⏰ Unsnoozed",
  "reminder.fired": "⏰ Reminder",
  "ingest.failed": "⚠️ Ingest failed",
};

export function DashboardClient() {
  const { data, refresh } = useApi<Dashboard>("/api/dashboard");
  useSse(() => void refresh(), ["message.new", "message.sent", "message.status", "conversation.updated"]);

  if (!data) return <Spinner className="h-full" />;
  const { stats } = data;
  const storage = stats.messageBytes + stats.attachmentBytes;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-mut2">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            {" · storage backend: "}
            {data.storageBackend === "r2" ? "Cloudflare R2" : "local disk"}
          </p>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile icon={MailOpen} label="Unread" value={stats.unread} href="/mail/unread" />
          <StatTile icon={Inbox} label="Received today" value={stats.receivedToday} href="/mail/all" />
          <StatTile icon={Send} label="Sent today" value={stats.sentToday} href="/mail/sent" />
          <StatTile
            icon={AlertTriangle}
            label="Delivery failures"
            value={stats.deliveryFailures + stats.ingestFailures}
            tone={stats.deliveryFailures + stats.ingestFailures > 0 ? "danger" : undefined}
          />
          <StatTile icon={CalendarClock} label="Scheduled" value={stats.scheduled} href="/mail/scheduled" />
          <StatTile
            icon={HardDrive}
            label="Storage"
            value={formatBytes(storage)}
            sub={`${formatBytes(stats.attachmentBytes)} attachments`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Email volume — last 14 days" icon={Activity}>
            <VolumeChart volume={data.volume} />
          </Card>

          <Card title="Most active domains" icon={Globe}>
            <div className="space-y-1">
              {data.domainActivity.slice(0, 6).map((d) => {
                const max = Math.max(1, ...data.domainActivity.map((x) => x.last7d));
                return (
                  <Link
                    key={d.id}
                    href={`/mail/all?domain=${d.id}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-elev"
                  >
                    <span style={{ color: d.color }}>{d.icon}</span>
                    <span className="w-40 truncate text-[13px]">{d.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elev2">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(d.last7d / max) * 100}%`, background: d.color }}
                      />
                    </div>
                    <span className="w-14 text-right text-xs text-mut">
                      {d.last7d} <span className="text-mut2">/7d</span>
                    </span>
                  </Link>
                );
              })}
              {data.domainActivity.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-mut2">No domains yet.</p>
              )}
            </div>
          </Card>

          <Card title="Top contacts" icon={Users} action={
            <Link href="/contacts" className="text-[11px] text-accent hover:underline">All contacts →</Link>
          }>
            <div className="space-y-0.5">
              {data.topContacts.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <Avatar name={c.name || c.email} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{c.name || c.email}</p>
                    {c.name && <p className="truncate text-[11px] text-mut2">{c.email}</p>}
                  </div>
                  <span className="text-xs text-mut">{c.messageCount} msgs</span>
                </div>
              ))}
              {data.topContacts.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-mut2">No contacts yet.</p>
              )}
            </div>
          </Card>

          <Card title="Largest attachments" icon={Paperclip}>
            <div className="space-y-0.5">
              {data.largestAttachments.map((a) => (
                <Link
                  key={a.id}
                  href={`/mail/all?c=${a.conversationId}`}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-elev"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-mut2" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{a.filename}</p>
                    <p className="truncate text-[11px] text-mut2">{a.subject}</p>
                  </div>
                  <span className="text-xs text-mut">{formatBytes(a.sizeBytes)}</span>
                </Link>
              ))}
              {data.largestAttachments.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-mut2">No attachments yet.</p>
              )}
            </div>
          </Card>

          <Card title="Delivery failures" icon={AlertTriangle}>
            <div className="space-y-0.5">
              {data.failures.map((f) => (
                <Link
                  key={f.id}
                  href={`/mail/all?c=${f.conversationId}`}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-elev"
                >
                  <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">
                    {f.status}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{f.subject || "(no subject)"}</p>
                    <p className="truncate text-[11px] text-mut2">{f.error || f.fromEmail}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-mut2">{timeAgo(f.date)}</span>
                </Link>
              ))}
              {data.failures.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-mut2">
                  ✨ No failures. Everything delivered.
                </p>
              )}
            </div>
          </Card>

          <Card title="Recent activity" icon={Activity} action={
            <Link href="/activity" className="text-[11px] text-accent hover:underline">Full log →</Link>
          }>
            <div className="space-y-0.5">
              {data.activity.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-lg px-2 py-1">
                  <span className="w-32 shrink-0 text-[12px]">{EVENT_LABELS[e.type] ?? e.type}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-mut">
                    {String(e.payload.subject ?? e.payload.from ?? e.payload.note ?? "")}
                  </span>
                  <span className="shrink-0 text-[11px] text-mut2">{timeAgo(e.createdAt)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

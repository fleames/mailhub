"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Globe,
  AtSign,
  Tag as TagIcon,
  PenLine,
  FileText,
  Send,
  Sparkles,
  Bell,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Star,
  Rocket,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  AlertTriangle,
  Plug,
  Copy,
  Layers,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import type { ConnectedAccount, Domain, Mailbox, MailboxGroup, Signature, Tag, Template } from "@/lib/client/types";
import { useShell } from "@/components/shell";
import { Badge, Button, Input, Select, Spinner, Switch, Textarea } from "@/components/ui";

const TABS = [
  { key: "setup", label: "Setup", icon: Rocket },
  { key: "domains", label: "Domains", icon: Globe },
  { key: "mailboxes", label: "Mailboxes", icon: AtSign },
  { key: "accounts", label: "Connected Accounts", icon: Plug },
  { key: "tags", label: "Tags", icon: TagIcon },
  { key: "signatures", label: "Signatures", icon: PenLine },
  { key: "templates", label: "Templates", icon: FileText },
  { key: "sending", label: "Sending", icon: Send },
  { key: "ai", label: "AI", icon: Sparkles },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "danger", label: "Danger Zone", icon: AlertTriangle },
] as const;

type SettingsMap = Record<string, unknown> & {
  _env?: {
    resendKeyFromEnv: boolean;
    aiKeyFromEnv: boolean;
    aiBaseUrl: string;
    aiModel: string;
    storageBackend: string;
    appUrl: string;
    microsoftRedirectUri: string;
  };
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-edge-soft bg-panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-mut2">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2">
      <label className="w-48 shrink-0 text-[13px] text-mut">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* ---------- Setup wizard tab ---------- */

type SetupStep = { step: string; ok: boolean; detail?: string };
type SetupStatus = {
  hasCfToken: boolean;
  hasResendKey: boolean;
  r2Ready: boolean;
  r2Probe?: string;
  bucket: string;
  workerName: string;
  connectedDomains: string[];
  zones?: { id: string; name: string; status: string }[];
  workerDeployed?: boolean;
  bucketExists?: boolean;
  cfError?: string;
};

function StepList({ steps }: { steps: SetupStep[] }) {
  return (
    <div className="mt-3 space-y-1.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-[13px]">
          {s.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          )}
          <span>
            {s.step}
            {s.detail && <span className="text-mut2"> — {s.detail}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        ok ? "border-success/30 bg-success/10 text-success" : "border-edge bg-elev text-mut"
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

type MxRecord = { id: string; type: string; name: string; content: string; priority?: number };

function SetupTab() {
  const { refreshMeta } = useShell();
  const { data: status, refresh, loading } = useApi<SetupStatus>("/api/setup/status");
  const [cfToken, setCfToken] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [globalBusy, setGlobalBusy] = useState(false);
  const [globalSteps, setGlobalSteps] = useState<SetupStep[] | null>(null);
  const [zoneBusy, setZoneBusy] = useState<string | null>(null);
  const [zoneSteps, setZoneSteps] = useState<Record<string, SetupStep[]>>({});
  const [mxConflicts, setMxConflicts] = useState<Record<string, MxRecord[]>>({});
  const [mxBusy, setMxBusy] = useState<string | null>(null);

  async function runGlobal() {
    setGlobalBusy(true);
    setGlobalSteps(null);
    try {
      const res = await api<{ steps: SetupStep[]; ok: boolean }>("/api/setup/global", {
        method: "POST",
        json: {
          ...(cfToken.trim() ? { cfToken: cfToken.trim() } : {}),
          ...(resendKey.trim() ? { resendKey: resendKey.trim() } : {}),
        },
      });
      setGlobalSteps(res.steps);
      if (res.ok) {
        toast.success("Global setup complete");
        setCfToken("");
        setResendKey("");
      }
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setGlobalBusy(false);
    }
  }

  async function connectZone(zone: { id: string; name: string }) {
    setZoneBusy(zone.id);
    try {
      const res = await api<{ steps: SetupStep[]; mxConflict?: boolean }>("/api/setup/domain", {
        method: "POST",
        json: { zoneId: zone.id, zoneName: zone.name },
      });
      setZoneSteps((prev) => ({ ...prev, [zone.id]: res.steps }));

      if (res.mxConflict) {
        try {
          const mx = await api<{ records: MxRecord[] }>(
            `/api/setup/domain/mx?zoneId=${encodeURIComponent(zone.id)}`
          );
          setMxConflicts((prev) => ({ ...prev, [zone.id]: mx.records }));
        } catch {
          // Non-fatal — the step list already explains what's wrong.
        }
      } else {
        setMxConflicts((prev) => {
          if (!(zone.id in prev)) return prev;
          const next = { ...prev };
          delete next[zone.id];
          return next;
        });
      }

      void refresh();
      refreshMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setZoneBusy(null);
    }
  }

  async function removeMxAndRetry(zone: { id: string; name: string }) {
    const records = mxConflicts[zone.id];
    if (!records?.length) return;
    const list = records.map((r) => `  ${r.content} (priority ${r.priority ?? "—"})`).join("\n");
    if (
      !confirm(
        `Remove ${records.length} existing MX record(s) for ${zone.name}?\n\n${list}\n\n` +
          "Any mail service currently using these records will stop receiving mail for this domain. Continue?"
      )
    ) {
      return;
    }
    setMxBusy(zone.id);
    try {
      await api("/api/setup/domain/mx", {
        method: "DELETE",
        json: { zoneId: zone.id, recordIds: records.map((r) => r.id) },
      });
      setMxConflicts((prev) => {
        const next = { ...prev };
        delete next[zone.id];
        return next;
      });
      toast.success("MX records removed — retrying connection");
      await connectZone(zone);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove MX records");
    } finally {
      setMxBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title="Automatic setup"
        hint="Paste two keys once — everything else (R2 bucket, storage credentials, email worker, routing, DNS records, Resend domains) is configured through the Cloudflare and Resend APIs."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <StatusChip ok={Boolean(status?.hasCfToken)} label="Cloudflare token" />
          <StatusChip ok={Boolean(status?.hasResendKey)} label="Resend key" />
          <StatusChip
            ok={Boolean(status?.r2Ready && status?.r2Probe === "ok")}
            label={`R2 storage (${status?.bucket ?? "mailhub"})`}
          />
          <StatusChip ok={Boolean(status?.workerDeployed)} label="Email worker" />
          <Button size="sm" variant="ghost" onClick={() => refresh(false)} busy={loading}>
            <RefreshCw className="h-3 w-3" /> Re-check
          </Button>
        </div>
        {status?.cfError && (
          <p className="mb-3 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger">
            Cloudflare API error: {status.cfError}
          </p>
        )}

        <Field label="Cloudflare API token">
          <Input
            value={cfToken}
            onChange={(e) => setCfToken(e.target.value)}
            placeholder={status?.hasCfToken ? "(saved — paste to replace)" : "paste token"}
            autoComplete="off"
          />
        </Field>
        <Field label="Resend API key">
          <Input
            value={resendKey}
            onChange={(e) => setResendKey(e.target.value)}
            placeholder={status?.hasResendKey ? "(saved — paste to replace)" : "re_…"}
            autoComplete="off"
          />
        </Field>
        <p className="mt-1 text-xs leading-relaxed text-mut2">
          Create the token at Cloudflare → My Profile → API Tokens → <b>Create Token</b> with
          permissions: <b>Account</b>: Workers Scripts <i>Edit</i>, Workers R2 Storage <i>Edit</i>,
          Account Settings <i>Read</i> · <b>Zone (all zones)</b>: Zone <i>Read</i>, DNS <i>Edit</i>,
          Email Routing Rules <i>Edit</i>, Zone Settings <i>Edit</i> (needed to enable Email
          Routing). The same token doubles as the R2 storage credential. Editing an existing
          token&apos;s permissions keeps its value — no need to re-paste here.
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            busy={globalBusy}
            onClick={runGlobal}
            disabled={!cfToken.trim() && !status?.hasCfToken}
          >
            <Rocket className="h-3.5 w-3.5" /> Run global setup
          </Button>
        </div>
        {globalSteps && <StepList steps={globalSteps} />}
      </Section>

      {status?.zones && (
        <Section
          title="Connect domains"
          hint="One click per domain: Email Routing on, catch-all → worker, Resend registration, DKIM/SPF DNS records, verification. Safe to re-run."
        >
          <div className="divide-y divide-edge-soft">
            {status.zones.map((z) => {
              const connected = status.connectedDomains.includes(z.name.toLowerCase());
              return (
                <div key={z.id} className="py-2.5">
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-mut2" />
                    <span className="flex-1 text-[13.5px] font-medium">{z.name}</span>
                    {connected && (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> in MailHub
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant={connected ? "default" : "primary"}
                      busy={zoneBusy === z.id}
                      onClick={() => connectZone(z)}
                    >
                      {connected ? "Re-run" : "Connect"}
                    </Button>
                  </div>
                  {zoneSteps[z.id] && <StepList steps={zoneSteps[z.id]} />}
                  {mxConflicts[z.id] && mxConflicts[z.id].length > 0 && (
                    <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" /> Existing MX records are blocking Email Routing
                      </p>
                      <ul className="mb-2 space-y-0.5 font-mono text-[11px] text-mut">
                        {mxConflicts[z.id].map((r) => (
                          <li key={r.id}>
                            {r.name} → {r.content} (priority {r.priority ?? "—"})
                          </li>
                        ))}
                      </ul>
                      <p className="mb-2 text-[11px] text-mut2">
                        These likely point mail elsewhere (another provider, or a leftover
                        record). Removing them lets Cloudflare route {z.name}&apos;s incoming
                        mail to MailHub — only do this if you want MailHub to take over.
                      </p>
                      <Button
                        size="sm"
                        variant="danger"
                        busy={mxBusy === z.id}
                        onClick={() => removeMxAndRetry(z)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove MX records & retry
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {status.zones.length === 0 && (
              <p className="py-4 text-center text-xs text-mut2">
                No active zones found on this Cloudflare account.
              </p>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ---------- Domains tab ---------- */

function DomainsTab() {
  const { refreshMeta } = useShell();
  const { data: domains, refresh } = useApi<Domain[]>("/api/domains");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🟢");
  const [color, setColor] = useState("#22c55e");
  const [guideFor, setGuideFor] = useState<string | null>(null);
  const { data: settings } = useApi<SettingsMap>("/api/settings");

  async function add() {
    try {
      await api("/api/domains", { method: "POST", json: { name: name.trim(), icon, color } });
      setName("");
      void refresh();
      refreshMeta();
      toast.success("Domain added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const appUrl = settings?._env?.appUrl ?? "https://your-mailhub-host";

  return (
    <div className="space-y-4">
      <Section title="Add domain" hint="A domain you own, with DNS on Cloudflare.">
        <div className="flex items-center gap-2">
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-14 text-center"
            maxLength={4}
          />
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-10 cursor-pointer rounded-lg border border-edge bg-elev"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="example.com"
            onKeyDown={(e) => e.key === "Enter" && name.trim() && add()}
          />
          <Button variant="primary" onClick={add} disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </Section>

      {domains?.map((d) => (
        <div key={d.id} className="rounded-2xl border border-edge-soft bg-panel p-5">
          <div className="flex items-center gap-3">
            <span className="text-lg" style={{ color: d.color }}>{d.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{d.name}</p>
              <p className="text-xs text-mut2">
                {d.mailboxCount ?? 0} mailboxes · {d.conversationCount ?? 0} conversations
              </p>
            </div>
            <input
              type="color"
              value={/^#/.test(d.color) ? d.color : "#22c55e"}
              onChange={async (e) => {
                await api(`/api/domains/${d.id}`, { method: "PATCH", json: { color: e.target.value } });
                void refresh();
                refreshMeta();
              }}
              className="h-8 w-9 cursor-pointer rounded-lg border border-edge bg-elev"
              title="Domain color"
            />
            <Input
              defaultValue={d.icon}
              maxLength={4}
              className="w-14 text-center"
              onBlur={async (e) => {
                if (e.target.value !== d.icon) {
                  await api(`/api/domains/${d.id}`, { method: "PATCH", json: { icon: e.target.value } });
                  void refresh();
                  refreshMeta();
                }
              }}
              title="Domain icon (emoji)"
            />
            <Button
              size="sm"
              onClick={() => setGuideFor(guideFor === d.id ? null : d.id)}
            >
              {guideFor === d.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Setup guide
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!confirm(`Remove ${d.name}? Its conversations keep existing but lose the domain badge.`)) return;
                await api(`/api/domains/${d.id}`, { method: "DELETE" });
                void refresh();
                refreshMeta();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {guideFor === d.id && (
            <div className="anim-fade mt-4 space-y-3 rounded-xl border border-edge-soft bg-elev p-4 text-[13px] leading-relaxed">
              <p className="font-semibold">Receive mail for {d.name}</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-mut">
                <li>
                  Cloudflare dashboard → <b>{d.name}</b> → <b>Email → Email Routing</b> → enable it
                  (Cloudflare adds the MX + SPF records automatically).
                </li>
                <li>
                  One-time (serves all domains): create the buffer bucket and deploy the worker —{" "}
                  <code className="rounded bg-elev2 px-1 py-0.5 font-mono text-xs">npx wrangler r2 bucket create mailhub</code>,
                  then <code className="rounded bg-elev2 px-1 py-0.5 font-mono text-xs">cd workers/email-inbound && npx wrangler deploy</code>.
                </li>
                <li>
                  Put your R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
                  R2_BUCKET=mailhub) in the app&apos;s <code className="rounded bg-elev2 px-1 py-0.5 font-mono text-xs">.env</code> and restart.
                </li>
                <li>
                  Email Routing → <b>Routing rules</b> → Catch-all → action <b>Send to Worker</b> →{" "}
                  <code className="rounded bg-elev2 px-1 py-0.5 font-mono text-xs">mailhub-inbound</code>.
                </li>
              </ol>
              <p className="text-xs text-mut2">
                Mail is buffered in R2 and this PC pulls it every 60 seconds — nothing is lost
                while the PC is off. Optional instant push: run a Cloudflare Tunnel to {appUrl} and
                set the worker secrets MAILHUB_URL + INBOUND_SECRET.
              </p>
              <p className="font-semibold">Send mail as {d.name}</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-mut">
                <li>Resend dashboard → Domains → Add <b>{d.name}</b>.</li>
                <li>Add the DKIM/SPF records Resend shows into Cloudflare DNS and verify.</li>
              </ol>
              <p className="text-xs text-mut2">
                That&apos;s it — any address @{d.name} (hello@, support@, anything) now lands here via catch-all,
                and mailboxes are created automatically on first mail.
              </p>
            </div>
          )}
        </div>
      ))}
      {!domains && <Spinner />}
    </div>
  );
}

/* ---------- Mailboxes tab ---------- */

function MailboxesTab() {
  const { refreshMeta } = useShell();
  const { data: mailboxes, refresh } = useApi<Mailbox[]>("/api/mailboxes");
  const { data: domains } = useApi<Domain[]>("/api/domains");
  const { data: signatures } = useApi<Signature[]>("/api/signatures");
  const [localPart, setLocalPart] = useState("");
  const [domainId, setDomainId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default once domains load async
    if (!domainId && domains?.length) setDomainId(domains[0].id);
  }, [domains, domainId]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function add() {
    try {
      await api("/api/mailboxes", { method: "POST", json: { domainId, localPart: localPart.trim() } });
      setLocalPart("");
      void refresh();
      refreshMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title="Add mailbox"
        hint="Mailboxes are also created automatically when mail arrives for a new address (catch-all)."
      >
        <div className="flex items-center gap-2">
          <Input
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            placeholder="hello"
            className="w-40"
            onKeyDown={(e) => e.key === "Enter" && localPart.trim() && add()}
          />
          <span className="text-mut">@</span>
          <Select value={domainId} onChange={(e) => setDomainId(e.target.value)} className="w-56">
            {domains?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
          <Button variant="primary" onClick={add} disabled={!localPart.trim() || !domainId}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </Section>

      <Section
        title="Mailboxes"
        hint="Grouped by domain — click a domain to manage its addresses. Display name is used as the From name; ★ marks the default sender."
      >
        <div className="space-y-1">
          {domains?.map((d) => {
            const domainMailboxes = mailboxes?.filter((m) => m.domainId === d.id) ?? [];
            const isExpanded = expanded.has(d.id);
            return (
              <div key={d.id} className="rounded-xl border border-edge-soft">
                <button
                  onClick={() => toggleExpanded(d.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                >
                  <ChevronRight
                    className={cn("h-3.5 w-3.5 shrink-0 text-mut2 transition-transform", isExpanded && "rotate-90")}
                  />
                  <span style={{ color: d.color }}>{d.icon || "●"}</span>
                  <span className="text-[13px] font-medium">{d.name}</span>
                  <span className="text-xs text-mut2">
                    {domainMailboxes.length} mailbox{domainMailboxes.length === 1 ? "" : "es"}
                  </span>
                </button>
                {isExpanded && (
                  <div className="divide-y divide-edge-soft border-t border-edge-soft px-3">
                    {domainMailboxes.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 py-2.5">
                        <button
                          title="Set as default sender"
                          onClick={async () => {
                            await api(`/api/mailboxes/${m.id}`, {
                              method: "PATCH",
                              json: { isDefault: !m.isDefault },
                            });
                            void refresh();
                            refreshMeta();
                          }}
                          className={cn("transition", m.isDefault ? "text-star" : "text-mut2 hover:text-star")}
                        >
                          <Star className="h-4 w-4" fill={m.isDefault ? "currentColor" : "none"} />
                        </button>
                        <span className="w-56 truncate font-mono text-[13px]">{m.email}</span>
                        <Input
                          defaultValue={m.displayName ?? ""}
                          placeholder="Display name"
                          className="max-w-48"
                          onBlur={async (e) => {
                            if (e.target.value !== (m.displayName ?? "")) {
                              await api(`/api/mailboxes/${m.id}`, {
                                method: "PATCH",
                                json: { displayName: e.target.value || null },
                              });
                              void refresh();
                              refreshMeta();
                            }
                          }}
                        />
                        <Select
                          value={m.signatureId ?? ""}
                          onChange={async (e) => {
                            await api(`/api/mailboxes/${m.id}`, {
                              method: "PATCH",
                              json: { signatureId: e.target.value || null },
                            });
                            void refresh();
                          }}
                          className="max-w-40"
                        >
                          <option value="">No signature</option>
                          {signatures?.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </Select>
                        <div className="flex-1" />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm(`Delete ${m.email}?`)) return;
                            await api(`/api/mailboxes/${m.id}`, { method: "DELETE" });
                            void refresh();
                            refreshMeta();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    ))}
                    {domainMailboxes.length === 0 && (
                      <p className="py-4 text-center text-xs text-mut2">
                        No mailboxes yet for this domain.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {domains?.length === 0 && (
            <p className="py-6 text-center text-xs text-mut2">No domains yet.</p>
          )}
        </div>
      </Section>
    </div>
  );
}

/* ---------- Tags tab ---------- */

const TAG_PRESETS = ["Support", "Billing", "Personal", "Important", "Client", "Launch", "SEO", "AI", "Pinned", "Urgent"];
const TAG_COLORS = ["#8b5cf6", "#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#f43f5e", "#ec4899", "#14b8a6"];

function TagsTab() {
  const { refreshMeta } = useShell();
  const { data: tags, refresh } = useApi<Tag[]>("/api/tags");
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);

  async function add(n?: string) {
    const tagName = (n ?? name).trim();
    if (!tagName) return;
    try {
      await api("/api/tags", {
        method: "POST",
        json: { name: tagName, color: n ? TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] : color },
      });
      setName("");
      void refresh();
      refreshMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const missing = TAG_PRESETS.filter(
    (p) => !tags?.some((t) => t.name.toLowerCase() === p.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <Section title="Create tag">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-10 cursor-pointer rounded-lg border border-edge bg-elev"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tag name"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button variant="primary" onClick={() => add()} disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {missing.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-xs text-mut2">Quick add:</span>
            {missing.map((p) => (
              <button
                key={p}
                onClick={() => add(p)}
                className="rounded-full border border-edge bg-elev px-2.5 py-0.5 text-xs text-mut transition hover:border-accent hover:text-ink"
              >
                + {p}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Tags">
        <div className="flex flex-wrap gap-2">
          {tags?.map((tg) => (
            <span
              key={tg.id}
              className="group flex items-center gap-2 rounded-full border border-edge bg-elev py-1 pl-1.5 pr-2"
            >
              <input
                type="color"
                value={tg.color}
                onChange={async (e) => {
                  await api(`/api/tags/${tg.id}`, { method: "PATCH", json: { color: e.target.value } });
                  void refresh();
                  refreshMeta();
                }}
                className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
              />
              <span className="text-[13px]">{tg.name}</span>
              <span className="text-[11px] text-mut2">{tg.conversationCount ?? 0}</span>
              <button
                onClick={async () => {
                  if (!confirm(`Delete tag "${tg.name}"?`)) return;
                  await api(`/api/tags/${tg.id}`, { method: "DELETE" });
                  void refresh();
                  refreshMeta();
                }}
                className="text-mut2 opacity-0 transition hover:text-danger group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {tags?.length === 0 && <p className="text-xs text-mut2">No tags yet.</p>}
        </div>
      </Section>
    </div>
  );
}

/* ---------- Signatures & Templates ---------- */

function EditorListTab({ kind }: { kind: "signatures" }) {
  const { data, refresh } = useApi<Signature[]>(`/api/${kind}`);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  async function add() {
    try {
      await api(`/api/${kind}`, { method: "POST", json: { name: name.trim(), html: body } });
      setName("");
      setBody("");
      void refresh();
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title="New signature"
        hint="HTML allowed. Appended to new emails from mailboxes using it (or the default)."
      >
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="— Best,<br><b>Your name</b>"
            className="font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button variant="primary" onClick={add} disabled={!name.trim() || !body.trim()}>
              <Plus className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        </div>
      </Section>

      {data?.map((item) => (
        <div key={item.id} className="rounded-2xl border border-edge-soft bg-panel p-5">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-sm font-semibold">{item.name}</p>
            {item.isDefault && <Badge color="var(--accent)">default</Badge>}
            <div className="flex-1" />
            {!item.isDefault && (
              <Button
                size="sm"
                onClick={async () => {
                  await api(`/api/signatures/${item.id}`, { method: "PATCH", json: { isDefault: true } });
                  void refresh();
                }}
              >
                Make default
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!confirm(`Delete "${item.name}"?`)) return;
                await api(`/api/${kind}/${item.id}`, { method: "DELETE" });
                void refresh();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-danger" />
            </Button>
          </div>
          <Textarea
            rows={4}
            defaultValue={item.html}
            className="font-mono text-xs"
            onBlur={async (e) => {
              const value = e.target.value;
              if (value !== item.html) {
                await api(`/api/${kind}/${item.id}`, { method: "PATCH", json: { html: value } });
                toast.success("Saved");
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

/* ---------- Templates tab ---------- */

function TemplatesTab() {
  const { data: templates, refresh } = useApi<Template[]>("/api/templates");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function add() {
    try {
      await api("/api/templates", {
        method: "POST",
        json: {
          name: name.trim(),
          subject,
          bodyHtml: body,
          category: category.trim(),
          shortcut: shortcut.trim() || null,
        },
      });
      setName("");
      setSubject("");
      setBody("");
      setShortcut("");
      void refresh();
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const filtered = (templates ?? []).filter((tpl) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return (
      tpl.name.toLowerCase().includes(s) ||
      tpl.category.toLowerCase().includes(s) ||
      (tpl.shortcut ?? "").toLowerCase().includes(s)
    );
  });

  const byCategory = new Map<string, Template[]>();
  for (const tpl of filtered) {
    const key = tpl.category.trim() || "Uncategorized";
    byCategory.set(key, [...(byCategory.get(key) ?? []), tpl]);
  }
  const categories = [...byCategory.keys()].sort((a, b) =>
    a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b)
  );

  function toggle(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Section
        title="New template"
        hint={
          <>
            Insert from the composer&apos;s template menu, or type{" "}
            <code className="rounded bg-elev2 px-1 py-0.5 font-mono text-[11px]">/shortcut</code>{" "}
            while composing to expand it inline.
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-[2]" />
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category (optional)"
              className="flex-1"
            />
            <Input
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value.replace(/[^a-z0-9-]/gi, ""))}
              placeholder="Shortcut, e.g. thanks"
              className="flex-1"
            />
          </div>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" />
          <Textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Template body (HTML)"
            className="font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button variant="primary" onClick={add} disabled={!name.trim() || !body.trim()}>
              <Plus className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Templates">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mut2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, category, or shortcut…"
            className="pl-9"
          />
        </div>
        <div className="space-y-1">
          {categories.map((cat) => {
            const isExpanded = expanded.has(cat) || Boolean(search.trim());
            const items = byCategory.get(cat) ?? [];
            return (
              <div key={cat} className="rounded-xl border border-edge-soft">
                <button
                  onClick={() => toggle(cat)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                >
                  <ChevronRight
                    className={cn("h-3.5 w-3.5 shrink-0 text-mut2 transition-transform", isExpanded && "rotate-90")}
                  />
                  <span className="text-[13px] font-medium">{cat}</span>
                  <span className="text-xs text-mut2">
                    {items.length} template{items.length === 1 ? "" : "s"}
                  </span>
                </button>
                {isExpanded && (
                  <div className="space-y-3 border-t border-edge-soft p-3">
                    {items.map((tpl) => (
                      <div key={tpl.id} className="rounded-lg border border-edge-soft bg-elev p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <p className="text-[13px] font-semibold">{tpl.name}</p>
                          {tpl.shortcut && (
                            <Badge color="var(--accent)">/{tpl.shortcut}</Badge>
                          )}
                          <div className="flex-1" />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              if (!confirm(`Delete "${tpl.name}"?`)) return;
                              await api(`/api/templates/${tpl.id}`, { method: "DELETE" });
                              void refresh();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            defaultValue={tpl.category}
                            placeholder="Category"
                            className="flex-1 text-xs"
                            onBlur={async (e) => {
                              if (e.target.value !== tpl.category) {
                                await api(`/api/templates/${tpl.id}`, {
                                  method: "PATCH",
                                  json: { category: e.target.value },
                                });
                                void refresh();
                              }
                            }}
                          />
                          <Input
                            defaultValue={tpl.shortcut ?? ""}
                            placeholder="Shortcut"
                            className="flex-1 text-xs"
                            onBlur={async (e) => {
                              const value = e.target.value.replace(/[^a-z0-9-]/gi, "");
                              if (value !== (tpl.shortcut ?? "")) {
                                await api(`/api/templates/${tpl.id}`, {
                                  method: "PATCH",
                                  json: { shortcut: value || null },
                                });
                                void refresh();
                              }
                            }}
                          />
                        </div>
                        <Textarea
                          rows={4}
                          defaultValue={tpl.bodyHtml}
                          className="mt-2 font-mono text-xs"
                          onBlur={async (e) => {
                            if (e.target.value !== tpl.bodyHtml) {
                              await api(`/api/templates/${tpl.id}`, {
                                method: "PATCH",
                                json: { bodyHtml: e.target.value },
                              });
                              toast.success("Saved");
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-xs text-mut2">
              {search.trim() ? "No matching templates." : "No templates yet."}
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}

/* ---------- Connected Accounts tab (Outlook / Microsoft 365) ---------- */

const ACCOUNT_STATUS_LABEL: Record<ConnectedAccount["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  active: { label: "Connected", tone: "success" },
  reauth_required: { label: "Needs reconnect", tone: "warning" },
  error: { label: "Error", tone: "danger" },
};

function ConnectedAccountsTab() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: settings, refresh: refreshSettings } = useApi<SettingsMap>("/api/settings");
  const { data: accounts, refresh: refreshAccounts } = useApi<ConnectedAccount[]>("/api/connected-accounts");
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- populating editable form state from an async fetch
    if (settings) setClientId(String(settings.microsoft_client_id ?? ""));
  }, [settings]);

  useEffect(() => {
    const connected = params.get("ms_connected");
    const error = params.get("ms_error");
    if (connected) {
      toast.success(`Connected ${connected}`);
      void refreshAccounts();
    }
    if (error) toast.error(error);
    if (connected || error) router.replace("/settings?tab=accounts");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per navigation, not on every refreshAccounts identity change
  }, [params, router]);

  async function saveClientId() {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", json: { microsoft_client_id: clientId } });
      toast.success("Client ID saved");
      void refreshSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeAccount(id: string, email: string) {
    if (!confirm(`Disconnect ${email}? Already-synced mail stays in your inbox.`)) return;
    await api(`/api/connected-accounts/${id}`, { method: "DELETE" });
    toast.success("Disconnected");
    void refreshAccounts();
  }

  function copyRedirectUri() {
    if (!settings?._env?.microsoftRedirectUri) return;
    void navigator.clipboard.writeText(settings._env.microsoftRedirectUri);
    toast.success("Copied");
  }

  if (!settings) return <Spinner />;

  return (
    <div className="space-y-4">
      <Section
        title="Microsoft Azure App Registration"
        hint="One-time setup so MailHub can ask Microsoft for permission to read/send mail on your behalf. No client secret is needed — this uses PKCE."
      >
        <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[13px] text-mut">
          <li>Go to portal.azure.com → Microsoft Entra ID → App registrations → New registration.</li>
          <li>
            Under &ldquo;Supported account types&rdquo; choose{" "}
            <span className="text-ink">
              &ldquo;Accounts in any organizational directory and personal Microsoft accounts&rdquo;
            </span>{" "}
            — so both outlook.com/hotmail and work/school accounts can connect.
          </li>
          <li>
            Under &ldquo;Redirect URI&rdquo; pick platform <span className="text-ink">Web</span> and paste the URI below.
          </li>
          <li>
            After creation, go to API permissions → Add a permission → Microsoft Graph → Delegated, and add:{" "}
            <span className="text-ink">Mail.ReadWrite</span>, <span className="text-ink">Mail.Send</span>,{" "}
            <span className="text-ink">User.Read</span>, <span className="text-ink">offline_access</span>.
          </li>
          <li>Copy the &ldquo;Application (client) ID&rdquo; from the Overview page and paste it below.</li>
        </ol>

        <Field label="Redirect URI">
          <div className="flex items-center gap-2">
            <Input value={settings._env?.microsoftRedirectUri ?? ""} readOnly className="font-mono text-xs" />
            <Button variant="default" size="sm" onClick={copyRedirectUri}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
        </Field>
        <Field label="Application (client) ID">
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" busy={saving} onClick={saveClientId}>
            Save
          </Button>
        </div>
      </Section>

      <Section
        title="Connected accounts"
        hint="Each account syncs its inbox in and can send mail as itself, alongside your owned domains."
      >
        <div className="mb-4">
          <Button
            variant="primary"
            disabled={!settings.microsoft_client_id}
            onClick={() => {
              window.location.href = "/api/oauth/microsoft/start";
            }}
          >
            <Plug className="h-3.5 w-3.5" /> Connect Microsoft Account
          </Button>
          {!settings.microsoft_client_id && (
            <p className="mt-1.5 text-xs text-mut2">Save a Client ID above first.</p>
          )}
        </div>

        {!accounts ? (
          <Spinner />
        ) : accounts.length === 0 ? (
          <p className="text-[13px] text-mut2">No Outlook/Microsoft 365 accounts connected yet.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => {
              const status = ACCOUNT_STATUS_LABEL[acc.status];
              return (
                <div
                  key={acc.id}
                  className="flex items-center gap-3 rounded-xl border border-edge-soft px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {acc.displayName || acc.emailAddress}
                      </span>
                      <Badge color={status.tone === "success" ? "#22c55e" : status.tone === "warning" ? "#f59e0b" : "#ef4444"}>
                        {status.label}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-mut2">
                      {acc.emailAddress}
                      {acc.lastSyncedAt && ` · synced ${new Date(acc.lastSyncedAt).toLocaleString()}`}
                    </div>
                    {acc.lastError && (
                      <div className="mt-0.5 truncate text-xs text-danger" title={acc.lastError}>
                        {acc.lastError}
                      </div>
                    )}
                  </div>
                  {acc.status !== "active" && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        window.location.href = "/api/oauth/microsoft/start";
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                    </Button>
                  )}
                  <Button variant="danger" size="sm" onClick={() => removeAccount(acc.id, acc.emailAddress)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------- Key/value settings tabs ---------- */

function KvTab({ tab }: { tab: "sending" | "ai" | "notifications" }) {
  const { data: settings, refresh } = useApi<SettingsMap>("/api/settings");
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- populating editable form state from an async fetch
    if (settings) setForm(settings);
  }, [settings]);

  const str = (k: string) => String(form[k] ?? "");
  const boolVal = (k: string, dflt: boolean) =>
    form[k] === undefined ? dflt : form[k] === true;

  async function save(keys: string[]) {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const k of keys) if (form[k] !== undefined) payload[k] = form[k];
      await api("/api/settings", { method: "PUT", json: payload });
      toast.success("Settings saved");
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <Spinner />;

  if (tab === "sending") {
    return (
      <Section
        title="Resend"
        hint={
          settings._env?.resendKeyFromEnv
            ? "A key from the RESEND_API_KEY env var is active; a value here overrides it."
            : "Outbound email is sent through Resend."
        }
      >
        <Field label="API key">
          <Input
            value={str("resend_api_key")}
            onChange={(e) => setForm({ ...form, resend_api_key: e.target.value })}
            placeholder="re_…"
            type="text"
            autoComplete="off"
          />
        </Field>
        <Field label="Webhook signing secret">
          <Input
            value={str("resend_webhook_secret")}
            onChange={(e) => setForm({ ...form, resend_webhook_secret: e.target.value })}
            placeholder="whsec_… (Resend → Webhooks → endpoint /api/webhooks/resend)"
            autoComplete="off"
          />
        </Field>
        <Field label="Undo-send window (seconds)">
          <Input
            type="number"
            min={0}
            max={120}
            value={String(form.undo_send_seconds ?? 15)}
            onChange={(e) => setForm({ ...form, undo_send_seconds: Number(e.target.value) })}
            className="w-28"
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            busy={saving}
            onClick={() => save(["resend_api_key", "resend_webhook_secret", "undo_send_seconds"])}
          >
            Save
          </Button>
        </div>
      </Section>
    );
  }

  if (tab === "ai") {
    return (
      <Section
        title="AI provider"
        hint="Any OpenAI-compatible API. Defaults to DeepSeek. Powers summaries, reply suggestions, rewriting, translation, phishing checks, and auto-tagging."
      >
        <Field label="API key">
          <Input
            value={str("ai_api_key")}
            onChange={(e) => setForm({ ...form, ai_api_key: e.target.value })}
            placeholder={settings._env?.aiKeyFromEnv ? "(set via AI_API_KEY env var)" : "sk-…"}
            autoComplete="off"
          />
        </Field>
        <Field label="Base URL">
          <Input
            value={str("ai_base_url") || settings._env?.aiBaseUrl || ""}
            onChange={(e) => setForm({ ...form, ai_base_url: e.target.value })}
            placeholder="https://api.deepseek.com"
          />
        </Field>
        <Field label="Model">
          <Input
            value={str("ai_model") || settings._env?.aiModel || ""}
            onChange={(e) => setForm({ ...form, ai_model: e.target.value })}
            placeholder="deepseek-chat"
          />
        </Field>
        <Field label="Auto-tag new mail">
          <Switch
            checked={boolVal("auto_tag_inbound", false)}
            onChange={(v) => setForm({ ...form, auto_tag_inbound: v })}
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            busy={saving}
            onClick={() => save(["ai_api_key", "ai_base_url", "ai_model", "auto_tag_inbound"])}
          >
            Save
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="Notifications">
        <Field label="Notify on new mail">
          <Switch
            checked={boolVal("notify_on_inbound", true)}
            onChange={(v) => setForm({ ...form, notify_on_inbound: v })}
          />
        </Field>
        <Field label="Browser notifications">
          <div className="flex items-center gap-3">
            <Switch
              checked={boolVal("browser_notifications", true)}
              onChange={(v) => setForm({ ...form, browser_notifications: v })}
            />
            <Button
              size="sm"
              onClick={async () => {
                const perm = await Notification.requestPermission();
                toast(perm === "granted" ? "Browser notifications enabled" : `Permission: ${perm}`);
              }}
            >
              Grant permission
            </Button>
          </div>
        </Field>
        <Field label="Discord webhook URL">
          <Input
            value={str("discord_webhook_url")}
            onChange={(e) => setForm({ ...form, discord_webhook_url: e.target.value })}
            placeholder="https://discord.com/api/webhooks/…"
          />
        </Field>
        <p className="text-xs text-mut2">
          Default for all mail. Per-inbox overrides are configured below when you have combined inboxes.
        </p>
        <Field label="Slack webhook URL">
          <Input
            value={str("slack_webhook_url")}
            onChange={(e) => setForm({ ...form, slack_webhook_url: e.target.value })}
            placeholder="https://hooks.slack.com/services/…"
          />
        </Field>
        <Field label="Spam threshold (0–10)">
          <Input
            type="number"
            min={1}
            max={10}
            value={String(form.spam_threshold ?? 5)}
            onChange={(e) => setForm({ ...form, spam_threshold: Number(e.target.value) })}
            className="w-28"
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            busy={saving}
            onClick={() =>
              save([
                "notify_on_inbound",
                "browser_notifications",
                "discord_webhook_url",
                "slack_webhook_url",
                "spam_threshold",
              ])
            }
          >
            Save
          </Button>
        </div>
      </Section>
      <CombinedInboxWebhooksSection />
    </div>
  );
}

/* ---------- Combined inbox webhooks ---------- */

function CombinedInboxWebhooksSection() {
  const { data: groups, refresh } = useApi<MailboxGroup[]>("/api/mailbox-groups");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  if (!groups?.length) return null;

  function valueFor(localPart: string) {
    if (localPart in drafts) return drafts[localPart];
    return groups?.find((g) => g.localPart === localPart)?.discordWebhookUrl ?? "";
  }

  async function save(localPart: string) {
    setSaving(localPart);
    try {
      const discordWebhookUrl = valueFor(localPart).trim() || null;
      await api("/api/mailbox-groups", {
        method: "PATCH",
        json: { localPart, discordWebhookUrl },
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[localPart];
        return next;
      });
      void refresh();
      toast.success(`Saved webhook for ${localPart}@*`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section
      title="Combined inbox webhooks"
      hint="Route new mail for a combined inbox (same local part across multiple domains) to its own Discord channel. Overrides the global Discord webhook for that inbox."
    >
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.localPart} className="rounded-xl border border-edge-soft bg-elev p-3">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
              <Layers className="h-3.5 w-3.5 text-mut2" />
              <span>{g.localPart}@*</span>
              <span className="text-mut2">({g.domainCount} domains)</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={valueFor(g.localPart)}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [g.localPart]: e.target.value }))
                }
                placeholder="https://discord.com/api/webhooks/…"
              />
              <Button
                size="sm"
                variant="primary"
                busy={saving === g.localPart}
                onClick={() => save(g.localPart)}
              >
                Save
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- Danger Zone tab ---------- */

type ClearCounts = {
  conversations: number;
  messages: number;
  attachments: number;
  contacts: number;
  drafts: number;
  storageBytes: number;
};

const CLEAR_PHRASE = "DELETE ALL MAIL";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge-soft bg-elev px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wide text-mut2">{label}</p>
      <p className="text-base font-semibold">{value ?? "…"}</p>
    </div>
  );
}

function DangerZoneTab() {
  const router = useRouter();
  const { refreshMeta } = useShell();
  const { data: counts, refresh } = useApi<ClearCounts>("/api/admin/clear-inbox");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  async function clearAll() {
    if (phrase !== CLEAR_PHRASE) return;
    if (
      !confirm(
        "Final check: this permanently deletes every conversation, message, attachment, draft, and contact — including their files in storage.\n\nDomains, mailboxes, tags, signatures, templates, and settings are kept.\n\nThis cannot be undone. Continue?"
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/clear-inbox", { method: "POST", json: { confirm: phrase } });
      toast.success("All mail cleared — domains and settings were left untouched");
      setPhrase("");
      void refresh();
      refreshMeta();
      router.push("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear inbox");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Clear all mail"
      hint="Deletes every conversation, message, attachment, draft, contact, and activity-log entry — including their files in storage. Domains, mailboxes, tags, signatures, templates, and settings are never touched."
    >
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label="Conversations" value={counts?.conversations} />
        <Stat label="Messages" value={counts?.messages} />
        <Stat label="Attachments" value={counts?.attachments} />
        <Stat label="Contacts" value={counts?.contacts} />
        <Stat label="Drafts" value={counts?.drafts} />
        <Stat label="Storage" value={counts ? formatBytes(counts.storageBytes) : undefined} />
      </div>

      <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" /> This cannot be undone.
        </p>
        <label className="mb-1 block text-xs text-mut">
          Type <code className="rounded bg-elev2 px-1.5 py-0.5 font-mono text-[11px]">{CLEAR_PHRASE}</code> to confirm
        </label>
        <Input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder={CLEAR_PHRASE}
          className="mb-3 max-w-xs"
          autoComplete="off"
        />
        <Button variant="danger" busy={busy} disabled={phrase !== CLEAR_PHRASE} onClick={clearAll}>
          <Trash2 className="h-3.5 w-3.5" /> Permanently clear all mail
        </Button>
      </div>
    </Section>
  );
}

/* ---------- Page ---------- */

export function SettingsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") ?? "setup";

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-lg font-semibold tracking-tight">Settings</h1>
        <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-edge-soft bg-panel p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => router.replace(`/settings?tab=${t.key}`)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition",
                tab === t.key ? "bg-accent-soft font-medium text-ink" : "text-mut hover:bg-elev hover:text-ink"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "setup" && <SetupTab />}
        {tab === "domains" && <DomainsTab />}
        {tab === "accounts" && <ConnectedAccountsTab />}
        {tab === "mailboxes" && <MailboxesTab />}
        {tab === "tags" && <TagsTab />}
        {tab === "signatures" && <EditorListTab kind="signatures" />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "sending" && <KvTab tab="sending" />}
        {tab === "ai" && <KvTab tab="ai" />}
        {tab === "notifications" && <KvTab tab="notifications" />}
        {tab === "danger" && <DangerZoneTab />}
      </div>
    </div>
  );
}

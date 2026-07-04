"use client";

import { useState } from "react";
import { Search, Users, Trash2, Pencil, Mail, AlertTriangle } from "lucide-react";
import { api } from "@/lib/client/api";
import { timeAgo, useApi } from "@/lib/client/hooks";
import type { Contact } from "@/lib/client/types";
import { useShell } from "@/components/shell";
import { Avatar, Button, EmptyState, Input, Modal, Spinner, Textarea } from "@/components/ui";

const PAGE_SIZE = 50;

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const listPath = `/api/contacts?limit=${PAGE_SIZE}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
  const { data, setData, loading, error, refresh } = useApi<{ items: Contact[]; hasMore: boolean }>(listPath);
  const [loadingMore, setLoadingMore] = useState(false);
  const items = data?.items ?? [];

  const { openCompose } = useShell();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState({ name: "", company: "", notes: "" });

  function startEdit(c: Contact) {
    setForm({ name: c.name ?? "", company: c.company ?? "", notes: c.notes ?? "" });
    setEditing(c);
  }

  async function saveEdit() {
    if (!editing) return;
    await api(`/api/contacts/${editing.id}`, {
      method: "PATCH",
      json: {
        name: form.name || null,
        company: form.company || null,
        notes: form.notes || null,
      },
    });
    setEditing(null);
    void refresh();
  }

  async function loadMore() {
    if (!data?.hasMore) return;
    setLoadingMore(true);
    try {
      const more = await api<{ items: Contact[]; hasMore: boolean }>(
        `${listPath}&offset=${items.length}`
      );
      setData({ items: [...items, ...more.items], hasMore: more.hasMore });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
          <span className="text-xs text-mut2">
            {items.length}
            {data?.hasMore ? "+" : ""}
          </span>
          <div className="relative ml-auto w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mut2" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contacts…"
              className="pl-9"
            />
          </div>
        </div>

        {loading && items.length === 0 && <Spinner />}
        {!loading && error && items.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load contacts"
            description={error}
            action={
              <Button size="sm" variant="primary" onClick={() => refresh(false)}>
                Retry
              </Button>
            }
          />
        )}
        {!loading && !error && items.length === 0 && (
          <EmptyState
            icon={Users}
            title={q.trim() ? "No contacts match" : "No contacts yet"}
            description={
              q.trim()
                ? "Try a different name, email, or company."
                : "The address book builds itself as you send and receive mail."
            }
            action={
              !q.trim() && (
                <Button size="sm" variant="primary" onClick={() => openCompose()}>
                  <Mail className="h-3.5 w-3.5" /> Compose an email
                </Button>
              )
            }
          />
        )}

        <div className="overflow-hidden rounded-2xl border border-edge-soft">
          {items.map((c) => (
            <div
              key={c.id}
              className="group flex items-center gap-3 border-b border-edge-soft bg-panel px-4 py-3 last:border-0 hover:bg-elev"
            >
              <Avatar name={c.name || c.email} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">
                  {c.name || c.email}
                  {c.company && <span className="ml-2 text-xs text-mut2">{c.company}</span>}
                </p>
                <p className="truncate text-xs text-mut2">{c.email}</p>
                {c.notes && <p className="mt-0.5 truncate text-xs text-mut">📝 {c.notes}</p>}
              </div>
              <div className="hidden text-right text-[11px] text-mut2 sm:block">
                <p>{c.messageCount} messages · {c.conversationCount} conversations</p>
                <p>{c.lastContactedAt ? `contacted ${timeAgo(c.lastContactedAt)}` : "never contacted"}</p>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <Button size="sm" variant="ghost" onClick={() => openCompose({ to: [{ email: c.email, name: c.name ?? undefined }] })}>
                  <Mail className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => startEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Delete contact ${c.email}?`)) return;
                    await api(`/api/contacts/${c.id}`, { method: "DELETE" });
                    void refresh();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {data?.hasMore && (
          <div className="p-3 text-center">
            <Button size="sm" onClick={loadMore} busy={loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Edit ${editing?.email}`}>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-mut">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-mut">Company</label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-mut">Notes</label>
            <Textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

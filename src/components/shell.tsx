"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, PenSquare, Moon, Sun, LogOut, Command, Sparkles, Keyboard } from "lucide-react";
import type { Address, ConnectedAccount, Counts, Domain, Mailbox, MailboxGroup, Tag } from "@/lib/client/types";
import { useApi, useHotkeys, useSse } from "@/lib/client/hooks";
import { api } from "@/lib/client/api";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { Composer, type ComposeSeed } from "./composer";
import { AiChatPanel } from "./ai-chat-panel";
import { ShortcutsModal } from "./shortcuts-modal";
import { Button, IconButton } from "./ui";

type ShellData = {
  domains: Domain[];
  tags: Tag[];
  mailboxes: Mailbox[];
  mailboxGroups: MailboxGroup[];
  connectedAccounts: ConnectedAccount[];
  counts: Counts | null;
  refreshMeta: () => void;
  openCompose: (seed?: ComposeSeed) => void;
};

const ShellContext = createContext<ShellData | null>(null);
export function useShell(): ShellData {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside shell");
  return ctx;
}

export type { ComposeSeed, Address };

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: domains, refresh: refreshDomains } = useApi<Domain[]>("/api/domains");
  const { data: tags, refresh: refreshTags } = useApi<Tag[]>("/api/tags");
  const { data: mailboxes, refresh: refreshMailboxes } = useApi<Mailbox[]>("/api/mailboxes");
  const { data: mailboxGroups, refresh: refreshMailboxGroups } = useApi<MailboxGroup[]>("/api/mailbox-groups");
  const { data: connectedAccounts, refresh: refreshConnectedAccounts } = useApi<ConnectedAccount[]>("/api/connected-accounts");
  const { data: counts, refresh: refreshCounts } = useApi<Counts>("/api/counts");

  const [composeSeed, setComposeSeed] = useState<ComposeSeed | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Reads the DOM attribute the inline <script> in layout.tsx set from
    // localStorage before hydration — can't read `document` during SSR,
    // so this can't be a lazy useState initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme((document.documentElement.dataset.theme as "light" | "dark") || "dark");
    // The desktop app's password is a random secret auto-generated on
    // install and never shown to the user (see mailhub-desktop's
    // secrets.js) — the web-only "Lock" button has no way back in there,
    // so it's hidden when running inside Electron (preload.js exposes
    // window.mailhubDesktop only in that context).
    setIsDesktopApp(typeof window !== "undefined" && "mailhubDesktop" in window);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("mh_theme", next);
    } catch {}
  }, [theme]);

  const refreshMeta = useCallback(() => {
    void refreshDomains();
    void refreshTags();
    void refreshMailboxes();
    void refreshMailboxGroups();
    void refreshConnectedAccounts();
    void refreshCounts();
  }, [
    refreshDomains,
    refreshTags,
    refreshMailboxes,
    refreshMailboxGroups,
    refreshConnectedAccounts,
    refreshCounts,
  ]);

  // Live updates: refresh counts on any mail event; desktop notifications for new mail.
  useSse(
    (type, data) => {
      void refreshCounts();
      if (type === "message.new" && !data.spam) {
        const from = String(data.from ?? "Unknown");
        const subject = String(data.subject ?? "(no subject)");
        toast(`📬 ${from}`, {
          description: subject,
          action: {
            label: "Open",
            onClick: () => router.push(`/mail/all?c=${data.conversationId}`),
          },
        });
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted" &&
          document.hidden
        ) {
          new Notification(from, { body: subject, icon: "/favicon.ico" });
        }
      }
      if (type === "reminder.fired") {
        toast(`⏰ ${String(data.note ?? "Reminder")}`, {
          duration: 15000,
          ...(data.conversationId
            ? {
                action: {
                  label: "Open",
                  onClick: () => router.push(`/mail/all?c=${data.conversationId}`),
                },
              }
            : {}),
        });
      }
      if (type === "message.failed") {
        toast.error("Send failed", { description: String(data.error ?? "") });
      }
    },
    ["message.new", "message.sent", "message.failed", "message.status", "reminder.fired", "conversation.updated"]
  );

  const openCompose = useCallback((seed?: ComposeSeed) => {
    setComposeSeed(seed ?? {});
  }, []);

  useHotkeys({
    "mod+k": (e) => {
      e.preventDefault();
      setPaletteOpen((v) => !v);
    },
    "mod+j": (e) => {
      e.preventDefault();
      setAiChatOpen((v) => !v);
    },
    c: () => openCompose(),
    "/": (e) => {
      e.preventDefault();
      searchRef.current?.focus();
    },
    "?": (e) => {
      e.preventDefault();
      setShortcutsOpen((v) => !v);
    },
  });

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <ShellContext.Provider
      value={{
        domains: domains ?? [],
        tags: tags ?? [],
        mailboxes: mailboxes ?? [],
        mailboxGroups: mailboxGroups ?? [],
        connectedAccounts: connectedAccounts ?? [],
        counts,
        refreshMeta,
        openCompose,
      }}
    >
      <div className="flex h-screen overflow-hidden bg-base">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-13 shrink-0 items-center gap-3 border-b border-edge-soft px-4 [-webkit-app-region:drag]">
            <div className="relative w-full max-w-105 [-webkit-app-region:no-drag]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mut2" />
              <input
                ref={searchRef}
                placeholder="Search mail…"
                className="h-8.5 w-full rounded-lg border border-edge bg-elev pl-9 pr-16 text-[13px] outline-none transition placeholder:text-mut2 focus:border-accent"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.currentTarget.value.trim()) {
                    router.push(`/mail/all?q=${encodeURIComponent(e.currentTarget.value.trim())}`);
                  }
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                <span className="kbd">/</span>
              </span>
            </div>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAiChatOpen((v) => !v)}
              title="AI Chat"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="kbd ml-1">⌘J</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)}>
              <Command className="h-3.5 w-3.5" />
              <span className="kbd ml-1">⌘K</span>
            </Button>
            <IconButton label="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}>
              <Keyboard className="h-4 w-4" />
            </IconButton>
            <Button variant="ghost" size="sm" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {!isDesktopApp && (
              <Button variant="ghost" size="sm" onClick={logout} title="Lock">
                <LogOut className="h-4 w-4" />
              </Button>
            )}
            <Button variant="primary" onClick={() => openCompose()}>
              <PenSquare className="h-3.5 w-3.5" />
              Compose
              <span className="kbd ml-1 border-white/20 bg-white/10 text-white/70">C</span>
            </Button>
          </header>
          <main className="min-h-0 flex-1">{children}</main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AiChatPanel open={aiChatOpen} onClose={() => setAiChatOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {composeSeed !== null && (
        <Composer seed={composeSeed} onClose={() => setComposeSeed(null)} />
      )}
    </ShellContext.Provider>
  );
}

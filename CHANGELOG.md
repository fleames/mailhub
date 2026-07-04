# Changelog

## v2.0.0

**Compose & organize**
- Reusable **template system** — categories, search, and a `/shortcut` slash
  command that expands inline while composing
- **Combined inboxes** — mailboxes sharing a local part across domains
  (e.g. every `sales@` on every domain) collapse into one view
- Turn any **AI Chat** reply directly into an outgoing email, in one click
- Pagination on Contacts and the Activity log

**Fixes**
- Pure-outbound conversations (nothing received yet) no longer show up in
  "All Inbox" — that folder is inbound-first again
- Trashing a message from inside Trash no longer bounces it back to Inbox
- Admin **"clear all inboxes"** action wipes mail/contacts/history while
  leaving domains, mailboxes, and settings untouched

**UX pass**
- `?` opens a keyboard-shortcuts cheatsheet; `⌘Enter` sends from the composer
- Command palette (`⌘K`) now surfaces contacts, not just mail
- Archive/trash show an **Undo** action (single-row and bulk)
- Shared empty states with real calls-to-action instead of bare text
- First-run banner on the Dashboard pointing new installs at Setup
- App-branded error boundary and retry actions on failed loads, instead of
  spinning forever or falling through to a generic error screen
- Copy-to-clipboard on sender/recipient addresses, keyboard-operable
- Visible focus ring (`:focus-visible`) on every interactive element

**Security & CI**
- Patched a SQL-injection advisory in `drizzle-orm`, plus `dompurify`,
  `esbuild`, and `postcss` advisories
- Added `.github/workflows/ci.yml` — lint, typecheck, build, and a
  dependency security scan on every PR
- Added `LICENSE` (GPL-3.0) and the matching `package.json` field
- Wired up ESLint (flat config, `eslint-config-next`)

## v1.0.0

Initial release — unified multi-domain inbox, Gmail-style threading,
Cloudflare Email Routing/Workers/R2 for inbound, Resend for outbound, AI
features (summarize, suggest replies, rewrite, phishing check, auto-tag),
zero-CLI domain setup, dashboard, dark/light themes, command palette.

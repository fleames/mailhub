<div align="center">

# 📬 MailHub

**One inbox for every domain you own — running on your own PC.**

[![Version](https://img.shields.io/badge/version-2.0.0-6366f1)](CHANGELOG.md)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1)](https://www.postgresql.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://www.typescriptlang.org)

Not a SaaS. No tenants, no billing, no seats. A self-hosted, single-user
email client that unifies every mailbox on every domain you own into one
Gmail-quality inbox, built to live on your own machine instead of a cloud
provider's server.

[Screenshots](#screenshots) · [Features](#features) · [Architecture](#architecture) ·
[Getting started](#getting-started) · [Connecting domains](#connecting-domains) ·
[Configuration](#configuration-reference) · [Contributing](#contributing) ·
[Changelog](CHANGELOG.md)

</div>

---

## Why this exists

If you own more than one domain, you've felt this: `hello@`, `support@`,
`billing@`, `admin@` scattered across a dozen inboxes, each requiring its own
login, each with its own notifications, none of them talking to each other.
Commercial shared-inbox tools solve this for teams and charge per seat for
the privilege. MailHub solves it for **one person** who just wants every
address they own to land in one place, with full control over where the
data lives.

It's designed explicitly to run on a personal computer that isn't always on
and doesn't have a public IP — not a VPS, not a container platform. Inbound
mail is store-and-forward through Cloudflare so nothing is lost while your
machine is off; everything else is a normal local web app you open in a
browser tab.

## Screenshots

<table>
<tr>
<td width="50%">

**Dashboard** — unread/received/sent stats, 14-day volume chart, top
contacts, largest attachments, delivery failures, activity feed.

![Dashboard](docs/screenshots/02-dashboard.png)

</td>
<td width="50%">

**Unified inbox** — every domain color-coded, tags, attachments indicator,
unread state, all in one list.

![Inbox](docs/screenshots/03-inbox.png)

</td>
</tr>
<tr>
<td width="50%">

**Thread view** — Gmail-style threading, scheduled/delivered/bounced status
chips, AI summary, reply/reply-all/forward, AI-suggested replies.

![Thread view](docs/screenshots/04-thread-view.png)

</td>
<td width="50%">

**Composer** — rich text or Markdown, AI rewrite/translate/subject
generation, templates, signatures, drag-and-drop attachments, scheduled
send.

![Composer](docs/screenshots/05-composer.png)

</td>
</tr>
<tr>
<td width="50%">

**Command palette** — `⌘K` to jump anywhere or search mail live, with
result previews.

![Command palette](docs/screenshots/06-command-palette.png)

</td>
<td width="50%">

**Bulk actions** — multi-select with a tri-state master checkbox; the
toolbar adapts to context (Restore/Delete forever in Trash, Archive/Trash
elsewhere).

![Multi-select](docs/screenshots/07-multi-select.png)

</td>
</tr>
<tr>
<td width="50%">

**Automatic domain setup** — paste a Cloudflare token and a Resend key;
everything else (R2 bucket, storage credentials, the email worker, DNS,
verification) is configured through their APIs.

![Setup wizard](docs/screenshots/12-settings-setup.png)

</td>
<td width="50%">

**Quick AI chat** — a floating DeepSeek (or any OpenAI-compatible model)
chat panel, separate from the email-specific AI actions, for anything you
need fine-tuned help with.

![AI chat](docs/screenshots/15-ai-chat-panel.png)

</td>
</tr>
<tr>
<td width="50%">

**Templates** — type `/` while composing to search and insert a saved
template inline, no mouse required.

![Slash template picker](docs/screenshots/18-slash-templates.png)

</td>
<td width="50%">

**Keyboard-driven** — `?` opens a full shortcuts cheatsheet; almost every
action in the app is one keystroke away.

![Keyboard shortcuts](docs/screenshots/16-shortcuts.png)

</td>
</tr>
</table>

<details>
<summary>More screenshots — Contacts, Activity log, Domains, Tags, Trash, Spam, Templates settings</summary>

| | |
|---|---|
| ![Contacts](docs/screenshots/10-contacts.png) Auto-built address book | ![Activity log](docs/screenshots/11-activity-log.png) Full paginated audit log |
| ![Domains](docs/screenshots/13-settings-domains.png) Per-domain setup guide + color/icon | ![Tags](docs/screenshots/14-settings-tags.png) Custom labels with quick-add presets |
| ![Trash](docs/screenshots/09-trash-folder.png) Restore / delete forever | ![Spam](docs/screenshots/08-spam-folder.png) Heuristic spam scoring with reasons |
| ![Templates](docs/screenshots/17-settings-templates.png) Categories, search, and shortcuts | |

</details>

*(All screenshots use fictional seed data — `pnpm db:seed` recreates it.)*

## Features

**Unified inbox**
- Every mailbox on every connected domain in one Gmail-style threaded view
- **Combined inboxes** — mailboxes sharing a local part across domains (every
  `sales@` on every domain, say) collapse into a single view
- "All Inbox" is inbound-first: a conversation you've only ever sent to,
  never received from, doesn't clutter it
- Domain badges with custom color + icon, click to filter
- Catch-all support — any address on a domain works immediately, no
  per-mailbox provisioning
- Full-text search (Postgres `tsvector` + `pg_trgm`) across subject, body,
  sender, and attachment filenames — instant at personal scale
- Command palette (`⌘K`) searches mail *and* contacts, not just one or the
  other
- Custom tags with an AI auto-tag action
- Starred, Archive, Spam, Snoozed, Scheduled, Trash — all first-class
  folders, not filters bolted onto one list; Archive/Trash carry an
  **Undo** action, single-row and bulk

**Compose & send**
- Rich-text (TipTap) or Markdown editor, drag-and-drop attachments
- CC/BCC, reply-to, per-mailbox signatures
- **Templates** with categories and search — insert from a picker, or type
  `/shortcut` while composing to expand one inline without touching the mouse
- Turn any AI Chat reply directly into an outgoing email in one click
- **Undo send** and **scheduled send** are the same mechanism — every
  outbound message is queued for N seconds before Resend is called
- `⌘Enter` to send; draft autosave

**Receiving**
- Raw MIME persisted to object storage **before** parsing — a parser bug
  can never lose an email; failures become reprocessable dead-letter entries
- Gmail-style threading via `References`/`In-Reply-To`, falling back to
  subject + participant matching
- Heuristic spam scoring on top of Cloudflare's SPF/DKIM/DMARC results
- Attachments previewed in-browser (images, PDF, text) or downloaded;
  inline `cid:` images render correctly in HTML bodies

**AI (optional, any OpenAI-compatible provider — DeepSeek by default)**
- Thread summarization, 3-tone reply suggestions, rewrite/translate drafts,
  AI-generated subject lines, phishing/spam risk assessment, auto-tagging
- A separate general-purpose chat panel (`⌘J`) for anything else, with
  local-only chat history

**Automation**
- Snooze a thread; follow-up reminders that fire a notification later
- Discord/Slack webhook + desktop notifications on new mail
- Multi-select bulk actions (mark read/unread, archive, trash, restore,
  delete forever) with a proper select-all

**Zero-CLI domain setup**
- Paste a Cloudflare API token and a Resend key once; the app creates the
  R2 bucket, derives its own storage credentials from the token, deploys
  the email worker through the Workers API, and — per domain — enables
  Email Routing, sets the catch-all rule, registers the domain with Resend,
  writes its DKIM/SPF records, and triggers verification
- Detects and surfaces real-world blockers (existing MX records, missing
  token permissions) with an explicit, confirm-before-you-delete fix flow

**Dashboard**
- Unread / received-today / sent-today / delivery-failure counts
- 14-day inbound/outbound volume chart, most-active domains, top contacts,
  largest attachments, recent activity feed

**Everything else you'd expect**
- Full audit log (paginated) of every ingest, send, delivery event, and
  change; Contacts is paginated too
- Command palette (`⌘K`) with live search and navigation
- Keyboard-driven — press `?` any time for the full shortcuts cheatsheet
  (see [Keyboard shortcuts](#keyboard-shortcuts))
- Dark/light themes, resizable panels, live updates over SSE (no polling
  the UI, no page reloads)
- A **Danger Zone** to wipe all mail/contacts/history in one confirmed
  action while leaving domains, mailboxes, and settings untouched
- Accessible by construction: visible focus rings on every interactive
  element, keyboard-operable everywhere, a branded error boundary and
  retry affordance instead of a blank screen when something fails

## Architecture

**Stack:** Next.js 16 (single full-stack app, App Router) · PostgreSQL 17 ·
Drizzle ORM · Cloudflare Email Routing + Workers + R2 (inbound) · Resend
(outbound) · Cloudflare R2 or local disk (attachments + raw MIME) ·
Server-Sent Events (live updates) · DeepSeek or any OpenAI-compatible API ·
Docker.

### How mail flows

A personal PC has no public endpoint and isn't always on, so inbound mail
is **store-and-forward** rather than push: a Cloudflare Worker durably
buffers every message into R2 the instant it arrives, and MailHub pulls
that queue every 60 seconds whenever it happens to be running. Mail that
arrives while your PC is off simply waits. Delivery status is likewise
*polled* from Resend's API every 5 minutes, since webhooks can't reach a
machine with no public address (the webhook endpoint still exists and wins
the race if you ever put a tunnel in front of the app).

```
                 ┌───────────────────── Cloudflare (always on) ─────────────────────┐
inbound:  sender ─▶ Email Routing (catch-all, per domain) ─▶ Email Worker ─▶ R2 queue/…eml
                                                                                │
              your PC (whenever it's on) ── pull every 60s ◀────────────────────┘
                                            │
                                            ▼
                     raw .eml persisted BEFORE parsing (never lose mail)
                     parse (mailparser) → thread → store → contacts → spam score → SSE

outbound: composer ─▶ queued (undo window / schedule) ─▶ job runner ─▶ Resend
                       delivery status polled from Resend every 5 min ─▶ delivered/bounced
```

Optional **push mode**: run a Cloudflare Tunnel to your PC and set the
worker's `MAILHUB_URL` + `INBOUND_SECRET` secrets — mail then arrives
instantly via `POST /api/inbound`, with the R2 queue remaining as the
offline safety net, and Resend webhooks can reach `/api/webhooks/resend`
for instant delivery status too.

### Design decisions worth knowing

- **Raw-first ingestion.** The raw MIME is persisted to object storage
  *before* any parsing. Parse failures become dead-letter messages
  (`ingest_failed`) reprocessable from the stored raw
  (`POST /api/messages/:id/reingest`) — a parser bug can never lose mail.
- **Undo send == scheduled send.** Every outbound message is queued with
  `run_at = now + undo window` (default 15s). Undo just cancels the job;
  "Schedule send" is the same mechanism with a later timestamp.
- **No Redis, no queue service.** Scheduled sends, snoozes, and reminders
  are rows in a Postgres `jobs` table, claimed with `FOR UPDATE SKIP LOCKED`
  by an in-process poller (`src/lib/jobs.ts`). Two containers total: the
  app and Postgres.
- **Search is Postgres.** A generated, weighted `tsvector` + GIN index,
  plus `pg_trgm` for fuzzy address/filename matching. Instant at personal
  scale, no Elasticsearch/Meilisearch dependency.
- **Threading like Gmail.** `References`/`In-Reply-To` headers first;
  fallback to normalized subject + participant overlap within 60 days.
- **Email HTML is treated as hostile.** Bodies are DOMPurify-sanitized and
  rendered in a sandboxed iframe with scripts stripped. HTML attachments
  are served back as `text/plain` so they can never execute.
- **Delivery status, not tracking pixels.** Resend gives factual
  sent/delivered/bounced/complained per message — no 1×1 GIFs, which hurt
  deliverability and lie anyway.
- **Mailboxes auto-create.** Because routing is catch-all, any address on a
  connected domain works the instant mail arrives for it — no per-mailbox
  provisioning step.
- **Bookkeeping can never undo success.** Contact-tracking, event logging,
  and SSE notifications run in a nested try/catch *after* a send or ingest
  is already durably committed — a bug in that bookkeeping can be logged
  and ignored, never able to flip an already-successful send back to
  "failed" or duplicate an already-stored inbound message.

### Repo map

```
src/db/schema.ts            all tables — UUIDs everywhere, aggregate counters denormalized on conversations
src/lib/ingest.ts           inbound pipeline: raw-first storage, threading, dedupe, spam scoring, contacts
src/lib/send.ts             outbound pipeline: undo/schedule queue, Resend call, aggregate updates
src/lib/jobs.ts             DB-backed job runner (send / unsnooze / reminder / R2 drain / delivery poll)
src/lib/queries.ts          folder filters, conversation list, thread, sidebar counts
src/lib/r2-queue.ts         pull-mode inbound — drains the worker's R2 queue every 60s
src/lib/delivery-poll.ts    polls Resend for delivered/bounced/complained (webhook fallback)
src/lib/spam.ts             heuristics layered on Cloudflare's Authentication-Results header
src/lib/ai.ts               OpenAI-compatible chat client + prompts (DeepSeek by default)
src/lib/cloudflare.ts       Cloudflare API client used by the setup wizard (bucket/worker/DNS/routing)
src/lib/worker-script.ts    the Cloudflare Email Worker source, embedded for API-based deployment
src/app/api/…               ~40 route handlers (mail, search, contacts, tags, settings, AI, setup, admin)
src/components/…            app shell, sidebar, conversation list, thread view, composer, command palette,
                             AI chat panel, attachment viewer
workers/email-inbound/      the Cloudflare Email Worker source (for manual `wrangler deploy`)
scripts/migrate.mjs         dependency-light migration runner (no drizzle-kit at runtime)
drizzle/                    hand-authored + generated SQL migrations
```

### Security model

Single user, by design. `APP_PASSWORD` (constant-time compare, rate
limited) issues a 30-day HttpOnly signed JWT cookie. `src/proxy.ts` gates
every route except `/login`, `/api/inbound` (bearer secret), `/api/health`,
and `/api/webhooks/*` (rejected outright if no signing secret is
configured — never accepted unauthenticated). Cloudflare/Resend/R2/AI
credentials pasted into Settings are stored in the database, not logged,
and masked when read back through the API.

## Getting started

Requires Node 22+, pnpm, and Docker (for Postgres).

```bash
git clone https://github.com/<you>/mailhub.git
cd mailhub
cp .env.example .env            # fill in APP_PASSWORD, AUTH_SECRET, INBOUND_SECRET
docker compose up -d db         # Postgres on host port 5448 (deliberately not 5432)
pnpm install
pnpm db:migrate
pnpm db:seed                    # optional: fictional demo data (5 domains, threads, spam, contacts)
pnpm dev                        # http://localhost:3480  — log in with APP_PASSWORD
```

Prefer everything containerized? `docker compose up -d --build` runs the
app and Postgres with `restart: unless-stopped`; enable *Docker Desktop →
Start at login* and MailHub is simply always there at
`http://localhost:3480`. Without R2 credentials configured, attachments and
raw mail are stored on local disk (`./data/storage`, or the `mailhub_data`
volume in Docker) — the app works fully offline this way, just without
real inbound/outbound mail.

## Connecting domains

Open **Settings → Setup** and paste two keys:

1. **Cloudflare API token** — create at *Cloudflare → My Profile → API
   Tokens → Create Token* with:
   - **Account:** Workers Scripts `Edit`, Workers R2 Storage `Edit`,
     Account Settings `Read`
   - **Zone (all zones):** Zone `Read`, DNS `Edit`, Email Routing Rules
     `Edit`, Zone Settings `Edit` *(the enable-Email-Routing endpoint
     specifically requires this one)*
2. **Resend API key** (full access, so it can create/verify domains).

**Run global setup** verifies the token, creates the R2 buffer bucket,
derives S3 storage credentials directly from the token (Cloudflare's
documented scheme: access key = token ID, secret = SHA-256 of the token
value), proves them with a live write/delete probe, and deploys the email
worker through the Workers API — no `wrangler` CLI required. Every zone on
the account then gets a **Connect** button that enables Email Routing,
points the catch-all rule at the worker, registers the domain with Resend,
writes its DKIM/SPF records into Cloudflare DNS, and triggers verification.
Every step is idempotent, so re-running is always safe and doubles as a
health check.

If a domain already has MX records pointing elsewhere, Cloudflare refuses
to enable Email Routing (error 2008) rather than silently overriding
someone's existing mail setup — the wizard detects this, shows you exactly
which records exist, and only removes them if you explicitly confirm.

<details>
<summary>Manual setup, if you'd rather not paste API tokens</summary>

```bash
npx wrangler r2 bucket create mailhub
cd workers/email-inbound && npx wrangler deploy
```

Create an R2 API token yourself and put `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=mailhub` in `.env`.
Per domain: Cloudflare → Email Routing → enable it, then set the catch-all
rule to *Send to Worker* → `mailhub-inbound`. Add the domain in Resend
yourself and copy its DNS records into Cloudflare.
</details>

<details>
<summary>Optional: instant push instead of the 60s poll</summary>

Run `cloudflared tunnel` to `localhost:3480` and set the worker secrets
`MAILHUB_URL` (the tunnel URL) and `INBOUND_SECRET` (matching the app's).
Mail then arrives via `POST /api/inbound` immediately, with the R2 queue
remaining as the offline safety net. A tunnel also lets Resend webhooks
reach `/api/webhooks/resend` for instant delivery status instead of the
5-minute poll.
</details>

## Configuration reference

All of these can be set as environment variables in `.env`; most (Resend,
R2, AI, notifications) can *also* be set at runtime in **Settings**, which
takes precedence over the environment.

| Variable | Required | Purpose |
|---|---|---|
| `APP_PASSWORD` | ✅ | The single login password for the web UI |
| `AUTH_SECRET` | ✅ | Session JWT signing secret — 32+ chars, e.g. `openssl rand -hex 32` |
| `INBOUND_SECRET` | ✅ | Shared secret between the Cloudflare Worker and `/api/inbound` (push mode only) |
| `APP_URL` | | Public/tunnel URL of the app, used in notification links and the setup guide |
| `DATABASE_URL` | ✅ | Postgres connection string |
| `STORAGE_DIR` | | Local disk fallback for attachments/raw mail when R2 isn't configured |
| `RESEND_API_KEY` | for sending | Also settable in Settings → Sending |
| `RESEND_WEBHOOK_SECRET` | | Only needed for webhook (push/tunnel) mode |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | for receiving | Also derived automatically by the setup wizard |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | for AI features | OpenAI-compatible; defaults to DeepSeek. Also settable in Settings → AI |
| `UNDO_SEND_SECONDS` | | Undo-send window, default 15 |

See [`.env.example`](.env.example) for the full annotated template.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `C` | Compose |
| `/` | Focus search |
| `?` | Show the keyboard shortcuts cheatsheet |
| `⌘K` / `Ctrl K` | Command palette (mail *and* contacts) |
| `⌘J` / `Ctrl J` | Toggle AI chat |
| `J` / `K` or `↓` / `↑` | Move focus in the list |
| `Enter` / `O` | Open focused conversation |
| `X` | Toggle selection on the focused row |
| `E` | Archive (Undo available on the toast) |
| `S` | Star |
| `#` | Trash — or **delete forever** if already viewing Trash |
| `U` | Toggle read/unread |
| `Esc` | Close thread / clear selection |
| `⌘Enter` / `Ctrl Enter` | Send, from anywhere in the composer |

## Tech stack

[Next.js 16](https://nextjs.org) (App Router, Turbopack) ·
[React 19](https://react.dev) · [TypeScript](https://www.typescriptlang.org) ·
[Tailwind CSS v4](https://tailwindcss.com) ·
[Drizzle ORM](https://orm.drizzle.team) + [postgres.js](https://github.com/porsager/postgres) ·
[TipTap](https://tiptap.dev) rich-text editor ·
[mailparser](https://nodemailer.com/extras/mailparser/) ·
[Resend](https://resend.com) · [Cloudflare Workers/R2/Email Routing](https://developers.cloudflare.com/email-routing/) ·
[DOMPurify](https://github.com/cure53/DOMPurify) · [cmdk](https://cmdk.paco.me) ·
[Lucide](https://lucide.dev) icons · [Zod](https://zod.dev) · [Sonner](https://sonner.emilkowal.ski) ·
[react-resizable-panels](https://github.com/bvaughn/react-resizable-panels).

## Contributing

Issues and PRs are welcome. `.github/workflows/ci.yml` runs on every PR
(lint, typecheck, build, dependency security scan); the same checks locally:

```bash
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm build       # production build must pass
```

There's no test suite yet — for anything touching the ingest/send pipeline,
please describe how you verified it manually (e.g. "sent a real email
through Resend and confirmed it threaded correctly"). Keep PRs scoped: this
is a personal tool that deliberately avoids multi-tenant/SaaS complexity
(no orgs, no billing, no roles) — features that only make sense for
multi-user deployments are likely out of scope.

## Known limitations (deliberate)

- Office documents (`.docx`/`.xlsx`) preview as download-only — no
  external viewer service is called, so attachments never leave your own
  infrastructure.
- No automated test suite yet (see [Contributing](#contributing)).
- Calendar integration was left out as unnecessary scope for v1.

## License

[GPL-3.0](LICENSE). If you build on this, changes you distribute need to
stay open under the same license.

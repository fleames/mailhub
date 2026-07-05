import { randomBytes, createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import type { Address } from "@/db/schema";
import { getConfig } from "./config";
import { ingestRawEmail } from "./ingest";

/**
 * Microsoft Graph OAuth + mail sync for connected Outlook/M365 accounts.
 * Public client (no client secret) using Authorization Code + PKCE, against
 * the "common" tenant so both personal Microsoft accounts and work/school
 * accounts can connect. Inbound mail is pulled via Graph delta queries (we
 * don't own DNS for these mailboxes, so Cloudflare Email Routing can't see
 * them); outbound mail is a create-draft-then-send round trip so we can
 * capture the real Internet Message-ID Graph assigns for reply threading.
 */

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES =
  "openid profile email offline_access " +
  "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send " +
  "https://graph.microsoft.com/User.Read";

export type ConnectedAccount = typeof t.connectedAccounts.$inferSelect;

/* ---------- PKCE ---------- */

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

/**
 * Short-lived PKCE verifier storage between the /start redirect and the
 * /callback handler. In-memory is fine — this is a single-process,
 * single-owner app, and the whole flow completes in one browser round trip.
 */
const pendingAuth = new Map<string, { codeVerifier: string; createdAt: number }>();
const PENDING_TTL_MS = 10 * 60_000;

export function stashPendingAuth(state: string, codeVerifier: string): void {
  for (const [key, entry] of pendingAuth) {
    if (Date.now() - entry.createdAt > PENDING_TTL_MS) pendingAuth.delete(key);
  }
  pendingAuth.set(state, { codeVerifier, createdAt: Date.now() });
}

export function takePendingAuth(state: string): string | null {
  const entry = pendingAuth.get(state);
  if (!entry) return null;
  pendingAuth.delete(state);
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) return null;
  return entry.codeVerifier;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    const desc = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new Error(`Microsoft token request failed: ${desc}`);
  }
  return data as TokenResponse;
}

export async function exchangeCodeForTokens(opts: {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return tokenRequest({
    client_id: opts.clientId,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
}

async function refreshTokens(clientId: string, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPES,
  });
}

export async function fetchProfile(
  accessToken: string
): Promise<{ email: string; displayName: string | null }> {
  const res = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Microsoft profile (HTTP ${res.status})`);
  const data = await res.json();
  const email = (data.mail || data.userPrincipalName || "").toLowerCase();
  if (!email) throw new Error("Microsoft account has no usable email address");
  return { email, displayName: data.displayName ?? null };
}

/** Ensures a fresh access token, refreshing (and persisting) if it's expired or near-expiry. */
async function getValidAccessToken(account: ConnectedAccount): Promise<string> {
  const soonEnough = Date.now() + 2 * 60_000;
  if (account.tokenExpiresAt.getTime() > soonEnough) return account.accessToken;

  const cfg = await getConfig();
  if (!cfg.microsoftClientId) throw new Error("Microsoft client ID not configured");

  try {
    const tokens = await refreshTokens(cfg.microsoftClientId, account.refreshToken);
    await db
      .update(t.connectedAccounts)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? account.refreshToken,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        status: "active",
        lastError: null,
      })
      .where(eq(t.connectedAccounts.id, account.id));
    return tokens.access_token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(t.connectedAccounts)
      .set({ status: "reauth_required", lastError: msg })
      .where(eq(t.connectedAccounts.id, account.id));
    throw err;
  }
}

async function graph(
  account: ConnectedAccount,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const accessToken = await getValidAccessToken(account);
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers },
  });
  if (res.status === 401) {
    await db
      .update(t.connectedAccounts)
      .set({ status: "reauth_required", lastError: "Microsoft rejected the access token (401)" })
      .where(eq(t.connectedAccounts.id, account.id));
  }
  return res;
}

/* ---------- Inbound sync ---------- */

/** Pulls new inbox mail via Graph delta query, feeding raw MIME through the shared ingest pipeline. */
export async function syncAccountInbox(account: ConnectedAccount): Promise<number> {
  let ingested = 0;
  let url =
    account.deltaLink ??
    `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=id`;

  try {
    for (;;) {
      const res = await graph(account, url);
      if (res.status === 410) {
        // Delta token expired server-side — drop it and do a full resync next tick.
        await db
          .update(t.connectedAccounts)
          .set({ deltaLink: null })
          .where(eq(t.connectedAccounts.id, account.id));
        return ingested;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Graph delta query failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
      }
      const page = await res.json();

      for (const item of page.value ?? []) {
        if (item["@removed"]) continue;
        const rawRes = await graph(account, `${GRAPH}/me/messages/${item.id}/$value`);
        if (!rawRes.ok) continue; // message deleted/moved between list and fetch — skip, not fatal
        const raw = Buffer.from(await rawRes.arrayBuffer());
        const result = await ingestRawEmail({ raw, envelopeTo: account.emailAddress });
        if (result.ok && !result.deduped) ingested++;
      }

      if (page["@odata.nextLink"]) {
        url = page["@odata.nextLink"];
        continue;
      }
      if (page["@odata.deltaLink"]) {
        await db
          .update(t.connectedAccounts)
          .set({ deltaLink: page["@odata.deltaLink"], lastSyncedAt: new Date(), lastError: null })
          .where(eq(t.connectedAccounts.id, account.id));
      }
      break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Graph sync failed for ${account.emailAddress}:`, msg);
    await db
      .update(t.connectedAccounts)
      .set({ lastError: msg })
      .where(eq(t.connectedAccounts.id, account.id));
  }
  return ingested;
}

export async function syncAllConnectedAccounts(): Promise<number> {
  const accounts = await db
    .select()
    .from(t.connectedAccounts)
    .where(eq(t.connectedAccounts.status, "active"));
  let total = 0;
  for (const account of accounts) {
    total += await syncAccountInbox(account);
  }
  return total;
}

/* ---------- Outbound send ---------- */

export type GraphSendInput = {
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

const recipient = (a: Address) => ({
  emailAddress: { address: a.email, name: a.name },
});

/**
 * Creates a draft on the Graph mailbox and sends it, returning the real
 * Internet Message-ID Graph assigned — callers must persist this as the
 * message's messageId so future replies thread correctly.
 */
export async function sendViaGraph(
  account: ConnectedAccount,
  input: GraphSendInput
): Promise<{ internetMessageId: string }> {
  const internetMessageHeaders: { name: string; value: string }[] = [];
  if (input.inReplyTo) internetMessageHeaders.push({ name: "In-Reply-To", value: input.inReplyTo });
  if (input.references?.length) {
    internetMessageHeaders.push({ name: "References", value: input.references.join(" ") });
  }

  const draftBody = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients: input.to.map(recipient),
    ccRecipients: (input.cc ?? []).map(recipient),
    bccRecipients: (input.bcc ?? []).map(recipient),
    ...(input.replyTo ? { replyTo: [{ emailAddress: { address: input.replyTo } }] } : {}),
    ...(internetMessageHeaders.length ? { internetMessageHeaders } : {}),
    ...(input.attachments?.length
      ? {
          attachments: input.attachments.map((a) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: a.filename,
            contentType: a.contentType || "application/octet-stream",
            contentBytes: a.content.toString("base64"),
          })),
        }
      : {}),
  };

  const createRes = await graph(account, "/me/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draftBody),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`Graph draft creation failed (HTTP ${createRes.status}): ${body.slice(0, 300)}`);
  }
  const draft = await createRes.json();

  const sendRes = await graph(account, `/me/messages/${draft.id}/send`, { method: "POST" });
  if (!sendRes.ok) {
    const body = await sendRes.text().catch(() => "");
    throw new Error(`Graph send failed (HTTP ${sendRes.status}): ${body.slice(0, 300)}`);
  }

  return { internetMessageId: draft.internetMessageId as string };
}

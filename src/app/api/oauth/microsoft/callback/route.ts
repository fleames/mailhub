import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { getConfig } from "@/lib/config";
import { exchangeCodeForTokens, fetchProfile, takePendingAuth } from "@/lib/microsoft-graph";
import { logEvent } from "@/lib/bus";

/** Microsoft redirects here after the user consents (or cancels/errors). */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");

  const settingsUrl = new URL("/settings?tab=accounts", url.origin);
  const fail = (message: string) => {
    settingsUrl.searchParams.set("ms_error", message);
    return NextResponse.redirect(settingsUrl);
  };

  if (providerError) return fail(providerError);
  if (!code || !state) return fail("Microsoft didn't return an authorization code");

  const codeVerifier = takePendingAuth(state);
  if (!codeVerifier) return fail("This connection link expired — try connecting again");

  const cfg = await getConfig();
  if (!cfg.microsoftClientId) return fail("Microsoft Client ID is no longer configured");

  try {
    const redirectUri = `${url.origin}/api/oauth/microsoft/callback`;
    const tokens = await exchangeCodeForTokens({
      clientId: cfg.microsoftClientId,
      redirectUri,
      code,
      codeVerifier,
    });
    const profile = await fetchProfile(tokens.access_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const [existing] = await db
      .select()
      .from(t.connectedAccounts)
      .where(sql`lower(${t.connectedAccounts.emailAddress}) = ${profile.email}`);

    if (existing) {
      await db
        .update(t.connectedAccounts)
        .set({
          displayName: profile.displayName,
          status: "active",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? existing.refreshToken,
          tokenExpiresAt,
          scope: tokens.scope,
          lastError: null,
        })
        .where(eq(t.connectedAccounts.id, existing.id));
    } else {
      await db.insert(t.connectedAccounts).values({
        provider: "microsoft",
        emailAddress: profile.email,
        displayName: profile.displayName,
        status: "active",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? "",
        tokenExpiresAt,
        scope: tokens.scope,
      });
    }

    await logEvent("connected_account.connected", { payload: { email: profile.email } });
    settingsUrl.searchParams.set("ms_connected", profile.email);
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

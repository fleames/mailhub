import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getConfig } from "@/lib/config";
import {
  buildAuthUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  stashPendingAuth,
} from "@/lib/microsoft-graph";

/** Kicks off the OAuth dance: redirect the browser straight to Microsoft's consent page. */
export async function GET(req: NextRequest) {
  const cfg = await getConfig();
  if (!cfg.microsoftClientId) {
    return NextResponse.json(
      { error: "Set a Microsoft Client ID in Settings → Connected Accounts first" },
      { status: 400 }
    );
  }

  const state = randomUUID();
  const codeVerifier = generateCodeVerifier();
  stashPendingAuth(state, codeVerifier);

  const redirectUri = `${new URL(req.url).origin}/api/oauth/microsoft/callback`;
  const authUrl = buildAuthUrl({
    clientId: cfg.microsoftClientId,
    redirectUri,
    state,
    codeChallenge: codeChallengeFromVerifier(codeVerifier),
  });

  return NextResponse.redirect(authUrl);
}

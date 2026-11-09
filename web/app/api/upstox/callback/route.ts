import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const origin = url.origin;

  if (error) {
    return NextResponse.redirect(`${origin}/?auth=error&reason=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/?auth=error&reason=missing_code`);
  }
  const expected = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("upstox_oauth_state="))
    ?.split("=")[1];
  if (!expected || !state || expected !== state) {
    return NextResponse.redirect(`${origin}/?auth=error&reason=state_mismatch`);
  }

  const clientId = process.env.UPSTOX_CLIENT_ID;
  const clientSecret = process.env.UPSTOX_CLIENT_SECRET;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI || `${origin}/api/upstox/callback`;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/?auth=error&reason=missing_credentials`);
  }

  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const response = await fetch("https://api.upstox.com/v2/login/authorization/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Api-Version": "2.0",
      },
      body,
    });
    const payload = await response.json();
    if (!response.ok || !payload?.access_token) {
      return NextResponse.redirect(
        `${origin}/?auth=error&reason=${encodeURIComponent(JSON.stringify(payload?.errors || payload).slice(0, 120))}`
      );
    }
    const tokenPath =
      process.env.UPSTOX_TOKEN_FILE || path.join(os.homedir(), ".tradingagents", "upstox_tokens.json");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(
      tokenPath,
      JSON.stringify(
        {
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
          expires_at: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
          user: payload.user_name || payload.user_id || null,
          saved_at: new Date().toISOString(),
        },
        null,
        2
      )
    );
    const redirect = NextResponse.redirect(`${origin}/?auth=success`);
    redirect.cookies.delete("upstox_oauth_state");
    return redirect;
  } catch (errorValue) {
    return NextResponse.redirect(
      `${origin}/?auth=error&reason=${encodeURIComponent(
        errorValue instanceof Error ? errorValue.message : "token_exchange_failed"
      )}`
    );
  }
}

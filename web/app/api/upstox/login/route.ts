import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const clientId = process.env.UPSTOX_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "UPSTOX_CLIENT_ID is not configured" }, { status: 500 });
  }
  const origin = new URL(request.url).origin;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI || `${origin}/api/upstox/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const url = new URL("https://api.upstox.com/v2/login/authorization/dialog");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url.toString());
  response.cookies.set("upstox_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });
  return response;
}

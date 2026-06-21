import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.trycrewbase.com";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const token = searchParams.get("state"); // invite token passed as OAuth state
  const oauthError = searchParams.get("error");

  if (oauthError || !code || !token) {
    return NextResponse.redirect(
      `${APP_URL}/vendor/square-connect?error=${encodeURIComponent(oauthError ?? "missing_code")}`
    );
  }

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Look up the invite
  const { data: invite, error: inviteErr } = await admin
    .from("vendor_square_invites")
    .select("vendor_id, event_id, used")
    .eq("token", token)
    .single();

  if (inviteErr || !invite) {
    return NextResponse.redirect(`${APP_URL}/vendor/square-connect?error=invalid_token`);
  }
  if (invite.used) {
    return NextResponse.redirect(`${APP_URL}/vendor/square-connect?error=token_used`);
  }

  // Exchange code for Square access token
  const isSandbox = process.env.SQUARE_ENVIRONMENT !== "production";
  const tokenEndpoint = isSandbox
    ? "https://connect.squareupsandbox.com/oauth2/token"
    : "https://connect.squareup.com/oauth2/token";

  let tokenData: {
    access_token?: string;
    merchant_id?: string;
    error?: string;
    message?: string;
  };

  try {
    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": "2024-01-18",
      },
      body: JSON.stringify({
        client_id: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
        client_secret: process.env.SQUARE_APPLICATION_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${APP_URL}/api/square/vendor-callback`,
      }),
    });
    tokenData = await res.json();
  } catch {
    return NextResponse.redirect(`${APP_URL}/vendor/square-connect?error=token_fetch_failed`);
  }

  if (!tokenData.access_token) {
    const msg = encodeURIComponent(tokenData.message ?? tokenData.error ?? "token_error");
    return NextResponse.redirect(`${APP_URL}/vendor/square-connect?error=${msg}`);
  }

  // Save Square credentials to vendor_profiles
  const { error: profileErr } = await admin
    .from("vendor_profiles")
    .update({
      square_access_token: tokenData.access_token,
      square_merchant_id: tokenData.merchant_id ?? null,
      square_connected: true,
    })
    .eq("user_id", invite.vendor_id);

  if (profileErr) {
    console.error("[vendor-callback] profile update error:", profileErr.message);
    return NextResponse.redirect(`${APP_URL}/vendor/square-connect?error=db_error`);
  }

  // Mark invite as used
  await admin
    .from("vendor_square_invites")
    .update({ used: true })
    .eq("token", token);

  return NextResponse.redirect(`${APP_URL}/vendor/square-connect?success=true`);
}

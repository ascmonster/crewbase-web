import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    return NextResponse.redirect(
      `${origin}/dashboard?square_error=${encodeURIComponent(error ?? "missing_code")}`
    );
  }

  // Decode state
  let event_id: string;
  let promoter_id: string | null;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, "base64").toString("utf-8"));
    event_id = decoded.event_id;
    promoter_id = decoded.promoter_id ?? null;
  } catch {
    return NextResponse.redirect(`${origin}/dashboard?square_error=invalid_state`);
  }

  if (!event_id) {
    return NextResponse.redirect(`${origin}/dashboard?square_error=missing_event_id`);
  }

  // Exchange code for access token
  const isSandbox = process.env.SQUARE_ENVIRONMENT !== "production";
  const tokenEndpoint = isSandbox
    ? "https://connect.squareupsandbox.com/oauth2/token"
    : "https://connect.squareup.com/oauth2/token";

  const redirectUri = `${origin}/api/square/callback`;

  let tokenData: {
    access_token?: string;
    merchant_id?: string;
    expires_at?: string;
    error?: string;
    message?: string;
  };

  try {
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": "2024-01-18",
      },
      body: JSON.stringify({
        client_id: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
        client_secret: process.env.SQUARE_APPLICATION_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokenData = await tokenRes.json();
  } catch {
    return NextResponse.redirect(
      `${origin}/dashboard/events/${event_id}?tab=revenue&square_error=token_fetch_failed`
    );
  }

  if (!tokenData.access_token) {
    const msg = encodeURIComponent(tokenData.message ?? tokenData.error ?? "token_error");
    return NextResponse.redirect(
      `${origin}/dashboard/events/${event_id}?tab=revenue&square_error=${msg}`
    );
  }

  // Persist to Supabase using service role key (bypasses RLS)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  const admin = createSupabaseAdmin(supabaseUrl, serviceRoleKey);

  const expiresAt = tokenData.expires_at
    ? new Date(tokenData.expires_at).toISOString()
    : null;

  const { error: dbError } = await admin.from("event_square_config").upsert(
    {
      event_id,
      promoter_id,
      square_access_token: tokenData.access_token,
      square_merchant_id: tokenData.merchant_id ?? null,
      token_expires_at: expiresAt,
    },
    { onConflict: "event_id" }
  );

  if (dbError) {
    console.error("Failed to save Square config:", dbError.message);
    return NextResponse.redirect(
      `${origin}/dashboard/events/${event_id}?tab=revenue&square_error=${encodeURIComponent(dbError.message)}`
    );
  }

  return NextResponse.redirect(
    `${origin}/dashboard/events/${event_id}?tab=revenue&square=connected`
  );
}

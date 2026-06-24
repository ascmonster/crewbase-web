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
  let type: string = "promoter";
  let event_id: string | undefined;
  let promoter_id: string | null = null;
  let vendor_user_id: string | undefined;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, "base64").toString("utf-8"));
    type = decoded.type ?? "promoter";
    event_id = decoded.event_id;
    promoter_id = decoded.promoter_id ?? null;
    vendor_user_id = decoded.user_id;
  } catch {
    return NextResponse.redirect(`${origin}/dashboard?square_error=invalid_state`);
  }

  if (type !== "vendor" && !event_id) {
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
    refresh_token?: string;
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
    if (type === "vendor") {
      return NextResponse.redirect(`crewbase://square-callback?error=token_fetch_failed`);
    }
    return NextResponse.redirect(
      `${origin}/dashboard/events/${event_id}?tab=revenue&square_error=token_fetch_failed`
    );
  }

  if (!tokenData.access_token) {
    const msg = encodeURIComponent(tokenData.message ?? tokenData.error ?? "token_error");
    if (type === "vendor") {
      return NextResponse.redirect(`crewbase://square-callback?error=${msg}`);
    }
    return NextResponse.redirect(
      `${origin}/dashboard/events/${event_id}?tab=revenue&square_error=${msg}`
    );
  }

  // Fetch merchant business name from Square
  const merchantApiBase = isSandbox
    ? "https://connect.squareupsandbox.com/v2"
    : "https://connect.squareup.com/v2";

  let squareMerchantName: string | null = null;
  try {
    const merchantRes = await fetch(`${merchantApiBase}/merchants/me`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Square-Version": "2024-01-18",
      },
    });
    if (merchantRes.ok) {
      const merchantData = await merchantRes.json();
      squareMerchantName = merchantData.merchant?.business_name ?? null;
    } else {
      console.error("Square merchants/me error:", merchantRes.status);
    }
  } catch (e) {
    console.error("Square merchants/me fetch threw:", e);
  }

  // Persist to Supabase using service role key (bypasses RLS)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  const admin = createSupabaseAdmin(supabaseUrl, serviceRoleKey);

  // ── Vendor flow ───────────────────────────────────────────────────────────

  if (type === "vendor") {
    if (!vendor_user_id) {
      return NextResponse.redirect(`crewbase://square-callback?error=missing_user_id`);
    }

    const { error: dbError } = await admin
      .from("vendor_profiles")
      .upsert(
        {
          user_id:              vendor_user_id,
          square_access_token:  tokenData.access_token,
          square_refresh_token: tokenData.refresh_token ?? null,
          square_merchant_id:   tokenData.merchant_id ?? null,
          square_merchant_name: squareMerchantName,
          square_connected:     true,
          square_token_expires_at: tokenData.expires_at ? new Date(tokenData.expires_at).toISOString() : null,
        },
        { onConflict: "user_id" }
      );

    if (dbError) {
      console.error("Failed to save vendor Square config:", dbError.message);
      return NextResponse.redirect(
        `crewbase://square-callback?error=${encodeURIComponent(dbError.message)}`
      );
    }

    return NextResponse.redirect(
      `crewbase://square-callback?success=true&vendor_id=${encodeURIComponent(vendor_user_id)}`
    );
  }

  // ── Promoter flow (existing logic) ────────────────────────────────────────

  const expiresAt = tokenData.expires_at
    ? new Date(tokenData.expires_at).toISOString()
    : null;

  const { error: dbError } = await admin.from("event_square_config").upsert(
    {
      event_id,
      promoter_id,
      square_access_token: tokenData.access_token,
      square_merchant_id: tokenData.merchant_id ?? null,
      square_merchant_name: squareMerchantName,
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

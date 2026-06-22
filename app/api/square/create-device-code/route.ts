import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const SQ_VERSION = "2024-01-18";

function squareApiBase(): string {
  return process.env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com/v2"
    : "https://connect.squareup.com/v2";
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let event_id: string, vendor_id: string;
  try {
    ({ event_id, vendor_id } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!event_id || !vendor_id) {
    return NextResponse.json({ error: "event_id and vendor_id required" }, { status: 400 });
  }

  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Fetch vendor's Square access token from vendor_profiles
  const { data: profile, error: profileErr } = await admin
    .from("vendor_profiles")
    .select("square_access_token")
    .eq("user_id", vendor_id)
    .single();

  if (profileErr || !profile?.square_access_token) {
    return NextResponse.json({ error: "Vendor Square not connected" }, { status: 404 });
  }

  // Create device code via Square Terminal API
  let sqRes: Response;
  try {
    sqRes = await fetch(`${squareApiBase()}/terminals/device-codes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.square_access_token}`,
        "Square-Version": SQ_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        device_code: {
          name: "Crewbase Terminal",
          product_type: "TERMINAL_API",
        },
      }),
    });
  } catch (e: any) {
    console.error("[create-device-code] fetch threw:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const raw = await sqRes.text();
  if (!sqRes.ok) {
    console.error("[create-device-code] Square error:", sqRes.status, raw);
    return NextResponse.json({ error: `Square API error: ${raw}` }, { status: 502 });
  }

  const sqData = JSON.parse(raw);
  const deviceCode = sqData.device_code as { id: string; code: string } | undefined;

  if (!deviceCode?.id || !deviceCode?.code) {
    console.error("[create-device-code] no device_code in response:", raw);
    return NextResponse.json({ error: "No device code in Square response" }, { status: 502 });
  }

  // Save device_code_id to event_square_config for this vendor+event row
  const { error: upsertErr } = await admin
    .from("event_square_config")
    .upsert(
      { event_id, vendor_id, square_device_code_id: deviceCode.id },
      { onConflict: "event_id,vendor_id" }
    );
  if (upsertErr) {
    console.error("[create-device-code] upsert error:", upsertErr.message);
  }

  return NextResponse.json({ code: deviceCode.code, id: deviceCode.id });
}

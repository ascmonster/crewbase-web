import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "ORDERS_READ",
].join(" ");

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const event_id = searchParams.get("event_id");

  if (!event_id) {
    return NextResponse.json({ error: "Missing event_id" }, { status: 400 });
  }

  // Resolve the logged-in promoter's user ID by reading the session cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {}, // read-only in a GET handler
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const promoter_id = user?.id ?? null;

  const state = Buffer.from(
    JSON.stringify({ event_id, promoter_id })
  ).toString("base64");

  const isSandbox = process.env.SQUARE_ENVIRONMENT !== "production";
  const baseUrl = isSandbox
    ? "https://connect.squareupsandbox.com/oauth2/authorize"
    : "https://connect.squareup.com/oauth2/authorize";

  const redirectUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/square/callback`
    : `${request.nextUrl.origin}/api/square/callback`;

  const oauthUrl = new URL(baseUrl);
  oauthUrl.searchParams.set("client_id", process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID!);
  oauthUrl.searchParams.set("redirect_uri", redirectUrl);
  oauthUrl.searchParams.set("state", state);

  // Append scope manually so spaces are encoded as %20, not + (URLSearchParams uses +)
  const finalUrl = `${oauthUrl.toString()}&scope=${SCOPES.replace(/ /g, "%20")}`;

  return NextResponse.redirect(finalUrl);
}

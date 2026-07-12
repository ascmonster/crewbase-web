import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/* ────────────────────────────────────────────────────────────────────────────
 * Server-side route enforcement for the authenticated portals.
 *
 * Runs on /dashboard (promoter), /vendor (vendor) and /staff (staff) routes:
 *   1. Refreshes the Supabase session cookie (via getUser()).
 *   2. Redirects unauthenticated requests to /login.
 *   3. Blocks accounts whose approval_status is pending / rejected / suspended
 *      (role inferred from the portal path). This backs up the client-side
 *      route guards so a session can't reach a protected page server-side.
 * ──────────────────────────────────────────────────────────────────────────── */

const BLOCKED_STATUSES = ["pending", "rejected", "suspended"];

export async function middleware(request: NextRequest) {
  // Response we can mutate cookies on; recreated if the session is refreshed.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Validates the JWT with the auth server and refreshes the session cookie.
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const loginUrl = new URL("/login", request.url);

  // 1. Unauthenticated → login
  if (!user) {
    return NextResponse.redirect(loginUrl);
  }

  // 2. Approval enforcement — pick the profile table from the portal path.
  //    Staff routes have no approval table, so authentication alone is enough.
  let approvalStatus: string | null = null;
  if (path.startsWith("/vendor")) {
    const { data } = await supabase
      .from("vendor_profiles")
      .select("approval_status")
      .eq("user_id", user.id)
      .maybeSingle();
    approvalStatus = (data as { approval_status?: string | null } | null)?.approval_status ?? null;
  } else if (path.startsWith("/dashboard")) {
    const { data } = await supabase
      .from("promoter_profiles")
      .select("approval_status")
      .eq("user_id", user.id)
      .maybeSingle();
    approvalStatus = (data as { approval_status?: string | null } | null)?.approval_status ?? null;
  }

  if (approvalStatus && BLOCKED_STATUSES.includes(approvalStatus)) {
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*", "/vendor/:path*", "/staff/:path*"],
};

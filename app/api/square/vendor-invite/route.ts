import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { Resend } from "resend";

export async function POST(request: NextRequest) {
  try {
    const { event_id, vendor_id } = await request.json();
    if (!event_id || !vendor_id) {
      return NextResponse.json({ error: "Missing event_id or vendor_id" }, { status: 400 });
    }

    // Verify caller is authenticated and is the promoter of this event
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: event, error: evErr } = await admin
      .from("events")
      .select("id, promoter_id")
      .eq("id", event_id)
      .single();
    if (evErr || !event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (event.promoter_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Get promoter name from auth.users
    const { data: { user: promoterUser } } = await admin.auth.admin.getUserById(user.id);
    const promoterName =
      (promoterUser?.user_metadata?.full_name as string | undefined) ??
      promoterUser?.email ??
      "The event promoter";

    // Get vendor email from auth.users and business_name from vendor_profiles
    const { data: { user: vendorUser } } = await admin.auth.admin.getUserById(vendor_id);
    if (!vendorUser?.email) {
      return NextResponse.json({ error: "Vendor email not found" }, { status: 404 });
    }

    const { data: vendorProfile } = await admin
      .from("vendor_profiles")
      .select("business_name")
      .eq("user_id", vendor_id)
      .single();
    const businessName = vendorProfile?.business_name ?? "there";

    // Upsert invite row — always generates a fresh token so old links are invalidated
    const token = crypto.randomUUID();
    const { error: inviteErr } = await admin
      .from("vendor_square_invites")
      .upsert(
        { event_id, vendor_id, token, used: false },
        { onConflict: "event_id,vendor_id" }
      );
    if (inviteErr) {
      console.error("vendor_square_invites upsert error:", inviteErr.message);
      return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
    }

    const connectLink = `${process.env.NEXT_PUBLIC_APP_URL}/vendor/square-connect?token=${token}`;

    // Send email via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: emailErr } = await resend.emails.send({
      from: "Crewbase <noreply@trycrewbase.com>",
      to: vendorUser.email,
      subject: "Connect your Square account to receive payments",
      html: `
        <p>Hi ${businessName},</p>
        <p>${promoterName} has invited you to connect your Square account so you can receive automatic payments for your sales at the event.</p>
        <p>Click the link below to connect:</p>
        <p><a href="${connectLink}">${connectLink}</a></p>
        <p>This link is single-use. If you need a new one, ask the event promoter to resend the invite.</p>
      `,
    });
    if (emailErr) {
      console.error("Resend error:", emailErr);
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[vendor-invite] unhandled:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

"use client";

import { useEffect, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

type VendorProfile = {
  business_name: string | null;
  square_connected: boolean | null;
};

type Stats = {
  totalEvents: number;
  activeStaff: number;
  monthRevenue: number; // dollars
  pendingTimesheets: number;
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center">
      <p className="text-2xl font-bold text-[#FF6B35]">{value}</p>
      <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">{label}</p>
    </div>
  );
}

export default function VendorDashboardPage() {
  const { user, businessName, loading: authLoading } = useRequireVendorAuth();
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [stats, setStats] = useState<Stats>({ totalEvents: 0, activeStaff: 0, monthRevenue: 0, pendingTimesheets: 0 });
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const uid = user!.id;

      // Start of the current month (local) for revenue window
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [profileRes, eventsRes, staffRes, revenueRes, timesheetsRes] = await Promise.all([
        supabase
          .from("vendor_profiles")
          .select("business_name, square_connected")
          .eq("user_id", uid)
          .single(),
        supabase
          .from("event_vendors")
          .select("event_id", { count: "exact", head: true })
          .eq("vendor_id", uid),
        supabase
          .from("staff_vendor_assignments")
          .select("staff_id")
          .eq("vendor_id", uid),
        supabase
          .from("square_transactions")
          .select("amount_cents")
          .eq("vendor_id", uid)
          .gte("square_created_at", monthStart),
        supabase
          .from("schedules")
          .select("id", { count: "exact", head: true })
          .eq("vendor_id", uid)
          .eq("status", "pending"),
      ]);

      setProfile((profileRes.data as VendorProfile) ?? null);

      const staffIds = new Set(
        ((staffRes.data ?? []) as { staff_id: string }[]).map((r) => r.staff_id)
      );

      const revenueCents = ((revenueRes.data ?? []) as { amount_cents: number }[]).reduce(
        (sum, r) => sum + (r.amount_cents ?? 0),
        0
      );

      setStats({
        totalEvents: eventsRes.count ?? 0,
        activeStaff: staffIds.size,
        monthRevenue: revenueCents / 100,
        pendingTimesheets: timesheetsRes.count ?? 0,
      });

      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  if (authLoading || dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-zinc-500 text-sm">Loading…</span>
      </div>
    );
  }

  const name = profile?.business_name || businessName || "Vendor";

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Welcome card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-6 mb-8">
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Welcome back</p>
        <h1 className="text-2xl font-bold text-white">{name}</h1>
        <div className="mt-3 flex items-center gap-2">
          {profile?.square_connected ? (
            <span className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Square Connected
            </span>
          ) : (
            <span className="rounded border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-500">
              Square Not Connected
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Events" value={String(stats.totalEvents)} />
        <StatCard label="Active Staff" value={String(stats.activeStaff)} />
        <StatCard
          label="This Month"
          value={`$${stats.monthRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        />
        <StatCard label="Pending Timesheets" value={String(stats.pendingTimesheets)} />
      </div>
    </div>
  );
}

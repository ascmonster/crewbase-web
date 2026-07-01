"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────

type TimesheetRow = {
  id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, string> = {
  pending:   "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
  approved:  "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  rejected:  "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
  completed: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
};

function statusCls(status: string) {
  return STATUS_CFG[status.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20";
}

function fmtDate(s: string) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m ?? "00"} ${period}`;
}

// Hours between two "HH:MM[:SS]" strings; wraps past midnight
function hoursBetween(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map((n) => parseInt(n, 10));
    return h * 60 + (m || 0);
  };
  let diff = toMin(end) - toMin(start);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

function fmtHours(h: number) {
  return h.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function TimesheetDetailPage({ params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = use(params);
  const { user, loading: authLoading } = useRequireVendorAuth();

  const [staffName, setStaffName] = useState("");
  const [rows, setRows] = useState<TimesheetRow[]>([]);
  const [hourlyRate, setHourlyRate] = useState<number | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const uid = user!.id;

      const [userRes, schedRes, rateRes] = await Promise.all([
        supabase.from("users").select("full_name").eq("id", staffId).maybeSingle(),
        supabase
          .from("schedules")
          .select("id, shift_date, start_time, end_time, status")
          .eq("vendor_id", uid)
          .eq("staff_id", staffId)
          .order("shift_date", { ascending: false }),
        supabase
          .from("pay_rates")
          .select("base_rate")
          .eq("vendor_id", uid)
          .maybeSingle(),
      ]);

      setStaffName((userRes.data as { full_name: string } | null)?.full_name ?? "Staff Member");
      setRows((schedRes.data as TimesheetRow[]) ?? []);

      const base = (rateRes.data as { base_rate: number } | null)?.base_rate;
      setHourlyRate(base ?? null);

      setDataLoading(false);
    }
    load();
  }, [user?.id, staffId]);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    await createClient().from("schedules").update({ status }).eq("id", id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    setBusyId(null);
  }

  // Totals — exclude rejected / no-show from billable hours
  const billable = rows.filter((r) => !["rejected", "no_show"].includes(r.status.toLowerCase()));
  const totalHours = billable.reduce((sum, r) => sum + hoursBetween(r.start_time, r.end_time), 0);
  const estimatedPay = hourlyRate != null ? totalHours * hourlyRate : null;

  if (authLoading || dataLoading) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="h-4 w-32 rounded bg-white/[0.06] animate-pulse mb-6" />
        <div className="h-20 rounded-2xl bg-white/[0.03] animate-pulse mb-6" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Back */}
      <Link
        href="/vendor/dashboard/team"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors mb-5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to team
      </Link>

      <h1 className="text-xl font-bold text-white mb-1">{staffName}</h1>
      <p className="text-xs text-zinc-500 mb-6">Timesheets</p>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center">
          <p className="text-2xl font-bold text-white">{fmtHours(totalHours)}</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Total Hours</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center">
          <p className="text-2xl font-bold text-[#FF6B35]">
            {estimatedPay != null ? `$${estimatedPay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">
            {hourlyRate != null ? `Est. Pay · $${hourlyRate}/hr` : "No Pay Rate Set"}
          </p>
        </div>
      </div>

      {/* Timesheet rows */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-zinc-600">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <p className="text-zinc-400 font-medium">No timesheets yet</p>
          <p className="text-zinc-600 text-sm max-w-xs">Shifts for this staff member will appear here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const hrs = hoursBetween(r.start_time, r.end_time);
            const isPending = r.status.toLowerCase() === "pending";
            return (
              <div key={r.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{fmtDate(r.shift_date)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fmtTime(r.start_time)} – {fmtTime(r.end_time)} · {fmtHours(hrs)} hrs
                  </p>
                </div>
                {isPending ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => updateStatus(r.id, "approved")}
                      disabled={busyId === r.id}
                      className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 px-3 py-1 text-xs font-semibold hover:bg-emerald-600/40 transition-colors disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => updateStatus(r.id, "rejected")}
                      disabled={busyId === r.id}
                      className="rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 px-3 py-1 text-xs font-semibold hover:bg-rose-600/40 transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusCls(r.status)}`}>
                    {r.status.toUpperCase()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

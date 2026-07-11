"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ──────────────────────────────────────────────────────────────────

type ShiftRow = {
  id: string;
  date: string | null;
  vendor_name: string;
  role: string | null;
  hours: number;
  total: number;
  status: string;
};

type Period = "week" | "month" | "all";

// ── Helpers ────────────────────────────────────────────────────────────────

const ACCENT = "#2979FF";

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s.includes("T") ? s : s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function money(n: number) {
  return `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function periodStart(period: Period): Date | null {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return d;
  }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}
function inPeriod(dateStr: string | null, period: Period) {
  const start = periodStart(period);
  if (!start) return true;
  if (!dateStr) return false;
  return new Date(dateStr).getTime() >= start.getTime();
}
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function StaffEarningsPage() {
  const router = useRouter();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("week");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/login"); return; }

      const { data } = await supabase
        .from("shifts")
        .select("*, vendor:users!vendor_id(full_name), vendor_profile:vendor_profiles!vendor_id(business_name)")
        .eq("staff_id", session.user.id)
        .eq("status", "completed")
        .order("clock_in_time", { ascending: false });

      setShifts(((data ?? []) as any[]).map((r) => ({
        id: r.id,
        date: r.clock_in_time ?? r.shift_date ?? null,
        vendor_name: r.vendor_profile?.business_name ?? r.vendor?.full_name ?? "Unknown",
        role: r.role ?? null,
        hours: r.hours_worked ?? 0,
        total: r.total_pay ?? 0,
        status: r.status ?? "completed",
      })));
      setLoading(false);
    }
    load();
  }, [router]);

  const summary = useMemo(() => {
    const calc = (p: Period) => {
      const rows = shifts.filter((s) => inPeriod(s.date, p));
      return { hours: rows.reduce((a, s) => a + s.hours, 0), earnings: rows.reduce((a, s) => a + s.total, 0) };
    };
    return { week: calc("week"), month: calc("month"), all: calc("all") };
  }, [shifts]);

  const filtered = useMemo(() => shifts.filter((s) => inPeriod(s.date, period)), [shifts, period]);

  function exportCsv() {
    downloadCsv(`my-earnings-${period}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Date", "Vendor", "Role", "Hours", "Rate", "Total"],
      ...filtered.map((s) => [
        fmtDate(s.date), s.vendor_name, s.role ?? "",
        s.hours.toFixed(2),
        (s.hours > 0 ? s.total / s.hours : 0).toFixed(2),
        s.total.toFixed(2),
      ]),
    ]);
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="h-6 w-40 rounded bg-white/[0.06] animate-pulse mb-6" />
        <div className="grid grid-cols-3 gap-3 mb-6">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />)}
        </div>
        <div className="h-64 rounded-2xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />
      </div>
    );
  }

  const PERIOD_LABEL: Record<Period, string> = { week: "This Week", month: "This Month", all: "All Time" };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <h1 className="text-xl font-bold text-white mb-6">My Earnings</h1>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {(["week", "month", "all"] as Period[]).map((p) => (
            <div key={p} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
              <p className="text-2xl font-bold" style={{ color: ACCENT }}>{money(summary[p].earnings)}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{summary[p].hours.toFixed(1)} hrs</p>
              <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">{PERIOD_LABEL[p]}</p>
            </div>
          ))}
        </div>

        {/* Period tabs + export */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(["week", "month", "all"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${period === p ? "text-white" : "bg-[#1a1a1a] text-zinc-400 hover:text-white"}`}
              style={period === p ? { backgroundColor: ACCENT } : undefined}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-40"
            style={{ borderColor: `${ACCENT}66`, backgroundColor: `${ACCENT}1a`, color: ACCENT }}
          >
            Download CSV
          </button>
        </div>

        {/* Shifts table */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
            <p className="text-zinc-400 font-medium">No shifts in this period</p>
            <p className="text-zinc-600 text-sm mt-1">Completed shifts will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-zinc-500">
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Vendor</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-right font-medium">Hours</th>
                  <th className="px-4 py-3 text-right font-medium">Rate</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{fmtDate(s.date)}</td>
                    <td className="px-4 py-2.5 text-zinc-300">{s.vendor_name}</td>
                    <td className="px-4 py-2.5 text-zinc-500">{s.role ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{s.hours.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{money(s.hours > 0 ? s.total / s.hours : 0)}</td>
                    <td className="px-4 py-2.5 text-right text-white font-medium">{money(s.total)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        {(s.status || "completed").toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/[0.08] bg-white/[0.02] font-semibold">
                  <td className="px-4 py-3 text-zinc-400" colSpan={3}>Total ({filtered.length})</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{filtered.reduce((a, s) => a + s.hours, 0).toFixed(1)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right" style={{ color: ACCENT }}>{money(filtered.reduce((a, s) => a + s.total, 0))}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

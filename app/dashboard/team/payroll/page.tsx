"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type Shift = {
  id: string;
  staff_id: string;
  clock_in_time: string | null;
  hours_worked: number | null;
  total_pay: number | null;
  payment_status: string | null;
  staff_profiles: { full_name: string; abn: string | null; tfn: string | null } | null;
};

type Period = "week" | "month" | "custom";

function cutoffFor(period: Period, customStart: string, customEnd: string) {
  const now = new Date();
  if (period === "week")  { const s = new Date(); s.setDate(now.getDate() - 7); return { start: s, end: now }; }
  if (period === "month") { const s = new Date(); s.setMonth(now.getMonth() - 1); return { start: s, end: now }; }
  return { start: customStart ? new Date(customStart) : new Date(0), end: customEnd ? new Date(customEnd) : now };
}

export default function PayrollPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd]     = useState("");

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();

      // Get events this promoter owns
      const { data: eventData } = await supabase
        .from("events")
        .select("id")
        .eq("promoter_id", user!.id);
      const eventIds = (eventData ?? []).map((e: { id: string }) => e.id);

      if (eventIds.length === 0) {
        setShifts([]);
        setDataLoading(false);
        return;
      }

      const { data } = await supabase
        .from("shifts")
        .select("id, staff_id, clock_in_time, hours_worked, total_pay, payment_status, staff_profiles(full_name, abn, tfn)")
        .in("event_id", eventIds)
        .eq("status", "completed");

      setShifts((data as unknown as Shift[]) ?? []);
      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  if (authLoading || dataLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  const { start, end } = cutoffFor(period, customStart, customEnd);
  const filtered = shifts.filter((s) => {
    if (!s.clock_in_time) return false;
    const d = new Date(s.clock_in_time);
    return d >= start && d <= end;
  });

  // Group by staff_profiles.id (staff_id)
  const byStaff = (() => {
    const map: Record<string, { name: string; shifts: number; hours: number; amount: number; abn: string | null; tfn: string | null }> = {};
    filtered.forEach((s) => {
      const sid = s.staff_id;
      const fullName = s.staff_profiles?.full_name ?? sid;
      if (!map[sid]) map[sid] = { name: fullName, shifts: 0, hours: 0, amount: 0, abn: s.staff_profiles?.abn ?? null, tfn: s.staff_profiles?.tfn ?? null };
      map[sid].shifts += 1;
      map[sid].hours  += s.hours_worked ?? 0;
      map[sid].amount += s.total_pay ?? 0;
    });
    return Object.values(map);
  })();

  const totalShifts = filtered.length;
  const totalHours  = filtered.reduce((s, r) => s + (r.hours_worked ?? 0), 0);
  const totalPay    = filtered.reduce((s, r) => s + (r.total_pay ?? 0), 0);

  function exportCSV() {
    const csvEscape = (val: unknown): string => {
      if (val == null) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const rows = [
      ["Name", "ABN", "TFN", "Shifts", "Hours", "Total Pay"],
      ...byStaff.map((s) => [s.name, s.abn ?? "", s.tfn ?? "", String(s.shifts), s.hours.toFixed(2), s.amount.toFixed(2)]),
    ];
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `payroll-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    const htmlEscape = (val: unknown): string =>
      String(val ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const rows = byStaff.map((s) => `
      <tr>
        <td>${htmlEscape(s.name)}</td>
        <td>${htmlEscape(s.abn ?? "—")}</td>
        <td>${htmlEscape(s.tfn ?? "—")}</td>
        <td>${s.shifts}</td>
        <td>${s.hours.toFixed(2)}h</td>
        <td>$${s.amount.toFixed(2)}</td>
      </tr>`).join("");
    const html = `<!DOCTYPE html><html><head><title>Payroll Export</title><style>
      body{font-family:sans-serif;padding:24px;color:#111}
      h1{font-size:18px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #ddd;padding:8px 10px;text-align:left}
      th{background:#f5f5f5;font-weight:600}
      tfoot td{font-weight:700;background:#f0f0f0}
    </style></head><body>
      <h1>Payroll Report — ${new Date().toLocaleDateString()}</h1>
      <table><thead><tr><th>Name</th><th>ABN</th><th>TFN</th><th>Shifts</th><th>Hours</th><th>Pay</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td>${totalShifts}</td><td>${totalHours.toFixed(2)}h</td><td>$${totalPay.toFixed(2)}</td></tr></tfoot>
      </table>
    </body></html>`;
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); win.print(); }
  }

  const PERIODS: { key: Period; label: string }[] = [
    { key: "week",   label: "This Week" },
    { key: "month",  label: "This Month" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/team" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </Link>
        <h1 className="text-xl font-bold">Payroll Export</h1>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              period === p.key ? "bg-violet-600 text-white" : "border border-white/[0.08] text-zinc-400 hover:text-white"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="flex gap-3 mb-4">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
          <p className="text-2xl font-bold text-white">{totalShifts}</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Shifts</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
          <p className="text-2xl font-bold text-white">{totalHours.toFixed(1)}h</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Hours</p>
        </div>
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 px-4 py-4 text-center">
          <p className="text-2xl font-bold text-violet-300">${totalPay.toFixed(2)}</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Total Pay</p>
        </div>
      </div>

      {/* By staff */}
      {byStaff.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">By Staff</p>
          <div className="flex flex-col gap-2">
            {byStaff.map((s) => (
              <div key={s.name} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-sm font-bold shrink-0">
                  {s.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm">{s.name}</p>
                  <div className="flex gap-2 mt-0.5">
                    {s.abn && <span className="text-xs text-emerald-400 font-medium">ABN ✓</span>}
                    {s.tfn && <span className="text-xs text-emerald-400 font-medium">TFN ✓</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-white text-sm">${s.amount.toFixed(2)}</p>
                  <p className="text-xs text-zinc-500">{s.shifts} shifts · {s.hours.toFixed(1)}h</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {byStaff.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center text-zinc-500 text-sm mb-6">
          No approved shifts in this period
        </div>
      )}

      {/* Export buttons */}
      <div className="flex gap-3">
        <button
          onClick={exportCSV}
          disabled={byStaff.length === 0}
          className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-40"
        >
          Export CSV
        </button>
        <button
          onClick={exportPDF}
          disabled={byStaff.length === 0}
          className="flex-1 rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-40"
        >
          Export PDF
        </button>
      </div>
    </div>
  );
}

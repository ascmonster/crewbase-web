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
  event_id: string | null;
  staff_profiles: { full_name: string } | null;
  events: { name: string } | null;
};

type EventOption = { id: string; name: string };
type Period = "week" | "month" | "all" | "custom";

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map(({ label, value }) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div className="w-full bg-violet-600 rounded-t-sm" style={{ height: `${Math.max((value / max) * 100, 3)}%` }} />
          <span className="text-[9px] text-zinc-600 truncate w-full text-center">{label}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">{label}</p>
    </div>
  );
}

const CROWN = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
    <path d="M5 16L2 6l5 4 5-8 5 8 5-4-3 10H5z"/>
  </svg>
);

export default function AnalyticsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("all");

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();

      const { data: eventData } = await supabase
        .from("events")
        .select("id, name")
        .eq("promoter_id", user!.id);
      const eventList = (eventData as EventOption[]) ?? [];
      setEvents(eventList);
      const eventIds = eventList.map((e) => e.id);

      if (eventIds.length === 0) { setShifts([]); setDataLoading(false); return; }

      const { data: shiftsData } = await supabase
        .from("shifts")
        .select("id, staff_id, clock_in_time, hours_worked, total_pay, event_id, staff_profiles(full_name), events(name)")
        .in("event_id", eventIds)
        .eq("status", "completed")
        .order("clock_in_time", { ascending: true });

      const rows = (shiftsData as unknown as Shift[]) ?? [];
      setShifts(rows);

      // Ratings given by vendors, vendor_id=current user
      const { data: ratingsData } = await supabase
        .from("ratings")
        .select("stars")
        .eq("rater_role", "vendor")
        .eq("vendor_id", user!.id);

      if (ratingsData && ratingsData.length > 0) {
        const stars = (ratingsData as { stars: number }[]).map((r) => r.stars);
        setAvgRating(stars.reduce((a, b) => a + b, 0) / stars.length);
      }

      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  if (authLoading || dataLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  // Period filter
  function applyPeriod(rows: Shift[]) {
    if (period === "all") return rows;
    if (period === "week") {
      const cut = new Date(); cut.setDate(cut.getDate() - 7);
      return rows.filter((s) => s.clock_in_time && new Date(s.clock_in_time) >= cut);
    }
    if (period === "month") {
      const cut = new Date(); cut.setMonth(cut.getMonth() - 1);
      return rows.filter((s) => s.clock_in_time && new Date(s.clock_in_time) >= cut);
    }
    // custom
    const start = customStart ? new Date(customStart + "T00:00:00") : new Date(0);
    const end   = customEnd   ? new Date(customEnd   + "T23:59:59") : new Date();
    return rows.filter((s) => s.clock_in_time && new Date(s.clock_in_time) >= start && new Date(s.clock_in_time) <= end);
  }

  let filtered = applyPeriod(shifts);
  if (eventFilter !== "all") filtered = filtered.filter((s) => s.event_id === eventFilter);

  const totalSpent  = filtered.reduce((s, r) => s + (r.total_pay ?? 0), 0);
  const totalHours  = filtered.reduce((s, r) => s + (r.hours_worked ?? 0), 0);
  const totalShifts = filtered.length;

  // Last 14 days bar chart
  const chartData = (() => {
    const days: { label: string; date: Date }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, date: d });
    }
    return days.map(({ label, date }) => {
      const dayStr = date.toISOString().slice(0, 10);
      const val = filtered.filter((s) => s.clock_in_time?.startsWith(dayStr)).reduce((sum, s) => sum + (s.total_pay ?? 0), 0);
      return { label, value: val };
    });
  })();

  const topStaff = (() => {
    const map: Record<string, { name: string; shifts: number; hours: number; amount: number }> = {};
    filtered.forEach((s) => {
      const sid = s.staff_id;
      const sname = s.staff_profiles?.full_name ?? sid;
      if (!map[sid]) map[sid] = { name: sname, shifts: 0, hours: 0, amount: 0 };
      map[sid].shifts += 1;
      map[sid].hours  += s.hours_worked ?? 0;
      map[sid].amount += s.total_pay ?? 0;
    });
    return Object.values(map).sort((a, b) => b.shifts - a.shifts).slice(0, 3);
  })();

  const PERIODS: { key: Period; label: string }[] = [
    { key: "week",   label: "This Week" },
    { key: "month",  label: "This Month" },
    { key: "all",    label: "All Time" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/team" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </Link>
        <h1 className="text-xl font-bold flex-1">Analytics</h1>
        {events.length > 0 && (
          <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 outline-none focus:border-violet-500 transition-colors max-w-[180px]">
            <option value="all">All Events</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        )}
      </div>

      {/* Period tabs */}
      <div className="flex gap-0 mb-4 border-b border-white/[0.06]">
        {PERIODS.map((p) => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              period === p.key ? "text-white border-violet-500" : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="flex gap-3 mb-4">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors" />
          <span className="self-center text-zinc-500 text-sm">to</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors" />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Total Spent"      value={`$${totalSpent.toFixed(2)}`} />
        <StatCard label="Total Hours"      value={`${totalHours.toFixed(1)}h`} />
        <StatCard label="Total Shifts"     value={String(totalShifts)} />
        <StatCard label="Avg Staff Rating" value={avgRating != null ? `${avgRating.toFixed(1)} ★` : "—"} />
      </div>

      {/* 14-day chart */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5 mb-6">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Spending — Last 14 Days</p>
        {chartData.every((d) => d.value === 0) ? (
          <p className="text-xs text-zinc-600 text-center py-8">No completed shifts in this period</p>
        ) : (
          <BarChart data={chartData} />
        )}
      </div>

      {/* Top staff — by shift count, top 3, crown for #1 */}
      {topStaff.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Top Staff</p>
          <div className="flex flex-col gap-2">
            {topStaff.map((s, i) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="w-5 flex items-center justify-center shrink-0">
                  {i === 0 ? CROWN : <span className="text-xs font-bold text-zinc-600">{i + 1}</span>}
                </div>
                <div className="w-8 h-8 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-xs font-bold shrink-0">
                  {s.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{s.name}</p>
                  <p className="text-xs text-zinc-500">{s.shifts} shifts · {s.hours.toFixed(1)}h</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">${s.amount.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center text-zinc-500 text-sm">
          No completed shifts for this period
        </div>
      )}
    </div>
  );
}

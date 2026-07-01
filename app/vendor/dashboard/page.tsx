"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";
import { deriveDisplayStatus } from "@/lib/eventStatus";

// ── Types ──────────────────────────────────────────────────────────────────
// NOTE: shifts.vendor_id, shifts.clock_in_gps and events.vendor_id are asserted
// by this screen but not referenced elsewhere in the web codebase. Shifts are
// read with select("*") so a missing clock_in_gps column won't 400 the query.

type ActiveEvent = { id: string; name: string };

type ActiveShift = {
  id: string;
  staff_id: string;
  event_id: string | null;
  truck_id: string | null;
  truck_name: string | null;
  clock_in_time: string | null;
  clock_in_gps: unknown;
  name: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#8b5cf6", "#3498db", "#7c3aed", "#E91E8C", "#1abc9c", "#FF6B35"];

function hashColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initial(name: string) {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

function fmtClockTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtHHMM(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function minutesSince(iso: string | null, nowMs: number) {
  if (!iso) return 0;
  return Math.max(0, (nowMs - new Date(iso).getTime()) / 60000);
}

function fmtElapsed(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return h > 0 ? `${h}hr ${m}min` : `${m}min`;
}

function fmtTotalHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h}h ${m}m`;
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderGps(gps: any): string | null {
  if (!gps) return null;
  if (typeof gps === "string") return gps;
  if (typeof gps === "object") {
    const lat = gps.lat ?? gps.latitude;
    const lng = gps.lng ?? gps.longitude;
    if (lat != null && lng != null) return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Staff card ─────────────────────────────────────────────────────────────

function StaffCard({ shift, nowMs, onClockOut }: { shift: ActiveShift; nowMs: number; onClockOut: (s: ActiveShift) => void }) {
  const color = hashColor(shift.name || shift.staff_id);
  const elapsed = fmtElapsed(minutesSince(shift.clock_in_time, nowMs));
  const gps = renderGps(shift.clock_in_gps);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#1a1a1a] px-4 py-4 flex items-center gap-4">
      <div className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0" style={{ backgroundColor: color }}>
        {initial(shift.name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{shift.name}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Clocked in at {fmtClockTime(shift.clock_in_time)}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-xs font-medium text-emerald-400">On Shift</span>
          <span className="text-xs font-semibold text-[#FF6B35]">· {elapsed}</span>
        </div>
        <p className="text-[10px] font-mono text-zinc-600 mt-1">
          {gps ?? "Location not recorded"}
        </p>
      </div>
      <button
        onClick={() => onClockOut(shift)}
        className="shrink-0 rounded-lg border border-[#FF6B35]/50 bg-[#FF6B35]/10 px-3.5 py-2 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors"
      >
        Clock Out
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorDashboardPage() {
  const { user, businessName, loading: authLoading } = useRequireVendorAuth();

  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [baseRate, setBaseRate] = useState(0);
  const [events, setEvents] = useState<ActiveEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>("all");
  const [shifts, setShifts] = useState<ActiveShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  // Fetch active shifts (+ staff names, truck names)
  const loadShifts = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("shifts")
      .select("*, vendor_trucks(name)")
      .eq("vendor_id", user.id)
      .eq("status", "active");

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const rows = (data ?? []) as any[];
    const staffIds = [...new Set(rows.map((r) => r.staff_id).filter(Boolean))];
    let nameMap: Record<string, string> = {};
    if (staffIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", staffIds);
      nameMap = Object.fromEntries(((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]));
    }
    setShifts(rows.map((r) => ({
      id: r.id,
      staff_id: r.staff_id,
      event_id: r.event_id ?? null,
      truck_id: r.truck_id ?? null,
      truck_name: r.vendor_trucks?.name ?? null,
      clock_in_time: r.clock_in_time ?? null,
      clock_in_gps: r.clock_in_gps ?? null,
      name: nameMap[r.staff_id] ?? "Unknown",
    })));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    setLastUpdated(new Date());
    setNowMs(Date.now());
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const uid = user!.id;

      const [profileRes, rateRes, evRes, ownedRes] = await Promise.all([
        supabase.from("vendor_profiles").select("square_connected").eq("user_id", uid).maybeSingle(),
        supabase.from("pay_rates").select("base_rate").eq("vendor_id", uid).maybeSingle(),
        supabase.from("event_vendors").select("event_id").eq("vendor_id", uid),
        supabase.from("events").select("id, name, start_date, end_date, status, timezone").eq("vendor_id", uid),
      ]);

      setSquareConnected((profileRes.data as { square_connected: boolean | null } | null)?.square_connected ?? false);
      setBaseRate((rateRes.data as { base_rate: number } | null)?.base_rate ?? 0);

      // Assemble candidate events (via event_vendors join + vendor-owned)
      const linkedIds = ((evRes.data ?? []) as { event_id: string }[]).map((r) => r.event_id);
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const owned = (ownedRes.data ?? []) as any[];
      const ownedById: Record<string, any> = Object.fromEntries(owned.map((e) => [e.id, e]));

      let linked: any[] = [];
      if (linkedIds.length > 0) {
        const { data: linkedEvents } = await supabase
          .from("events")
          .select("id, name, start_date, end_date, status, timezone")
          .in("id", linkedIds);
        linked = (linkedEvents ?? []) as any[];
      }

      const merged: Record<string, any> = { ...ownedById };
      for (const e of linked) merged[e.id] = e;

      const active = Object.values(merged)
        .filter((e) => e.status !== "cancelled" && deriveDisplayStatus(e) === "active")
        .map((e) => ({ id: e.id as string, name: e.name as string }));
      /* eslint-enable @typescript-eslint/no-explicit-any */
      setEvents(active);

      await loadShifts();
      setLoading(false);
    }
    load();
  }, [user?.id, loadShifts]);

  // 30s poll — refetch shifts
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => { loadShifts(); }, 30000);
    return () => clearInterval(id);
  }, [user?.id, loadShifts]);

  // 60s tick — recalc labour cost / elapsed
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  async function clockOut(shift: ActiveShift) {
    if (typeof window !== "undefined" && !window.confirm(`Clock out ${shift.name}?`)) return;
    const out = new Date();
    const hours = minutesSince(shift.clock_in_time, out.getTime()) / 60;
    const pay = hours * baseRate;
    await createClient()
      .from("shifts")
      .update({
        status: "completed",
        clock_out_time: out.toISOString(),
        hours_worked: +hours.toFixed(2),
        total_pay: +pay.toFixed(2),
      })
      .eq("id", shift.id);
    setShifts((prev) => prev.filter((s) => s.id !== shift.id));
  }

  // Derived — filtered active shifts
  const filtered = selectedEvent === "all" ? shifts : shifts.filter((s) => s.event_id === selectedEvent);
  const totalMinutes = filtered.reduce((sum, s) => sum + minutesSince(s.clock_in_time, nowMs), 0);
  const labourCost = (totalMinutes / 60) * baseRate;

  // Group by truck when any filtered shift has a truck
  const anyTruck = filtered.some((s) => s.truck_id);
  const groups: { key: string; label: string | null; shifts: ActiveShift[] }[] = [];
  if (anyTruck) {
    const byTruck: Record<string, ActiveShift[]> = {};
    for (const s of filtered) {
      const key = s.truck_id ?? "__none__";
      (byTruck[key] ??= []).push(s);
    }
    for (const [key, list] of Object.entries(byTruck)) {
      groups.push({ key, label: key === "__none__" ? "Unassigned" : (list[0].truck_name ?? "Truck"), shifts: list });
    }
  } else {
    groups.push({ key: "__all__", label: null, shifts: filtered });
  }

  if (authLoading || loading) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="h-24 rounded-2xl bg-white/[0.03] animate-pulse mb-6" />
        <div className="h-28 rounded-2xl bg-[#1a1a1a] animate-pulse mb-6" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-[#1a1a1a] animate-pulse" />)}
        </div>
      </div>
    );
  }

  const name = businessName || "Vendor";

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Welcome card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-6 mb-6">
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Welcome back</p>
        <h1 className="text-2xl font-bold text-white">{name}</h1>
        <div className="mt-3 flex items-center gap-2">
          {squareConnected ? (
            <span className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Square Connected
            </span>
          ) : (
            <span className="rounded border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-500">Square Not Connected</span>
          )}
        </div>
      </div>

      {/* Event filter bar */}
      <div className="mb-6">
        {events.length === 0 ? (
          <p className="text-sm italic text-zinc-600">No active events right now</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
            {[{ id: "all", name: "All" }, ...events].map((e) => {
              const active = selectedEvent === e.id;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedEvent(e.id)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    active ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"
                  }`}
                >
                  {e.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Labour Cost */}
      <div className="rounded-2xl bg-[#1a1a1a] border-l-4 border-[#FF6B35] px-5 py-5 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Live Labour Cost</p>
        <p className="text-4xl font-bold text-[#FF6B35]">{fmtMoney(labourCost)}</p>
        <p className="text-xs text-zinc-500 mt-2">
          {filtered.length} staff on shift · {fmtTotalHours(totalMinutes)} total hours
        </p>
      </div>

      {/* Live staff list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-4xl">👥</div>
          <p className="text-zinc-400 font-medium">No staff currently on shift</p>
          <p className="text-zinc-600 text-sm max-w-xs">Staff will appear here once they clock in</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-6 mb-6">
            {groups.map((g) => (
              <div key={g.key}>
                {g.label && (
                  <p className="text-xs font-semibold text-zinc-400 mb-3">🚚 {g.label} · {g.shifts.length} on shift</p>
                )}
                <div className="flex flex-col gap-3">
                  {g.shifts.map((s) => (
                    <StaffCard key={s.id} shift={s} nowMs={nowMs} onClockOut={clockOut} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Summary bar */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-400">{filtered.length} staff currently on shift</span>
            <span className="text-xs text-zinc-500">Updated {fmtHHMM(lastUpdated)}</span>
          </div>
        </>
      )}
    </div>
  );
}

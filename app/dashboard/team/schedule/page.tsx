"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Schedule = {
  id: string;
  staff_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  role: string | null;
  notes: string | null;
  status: string | null;
  truck_id: string | null;
  pay_rate: number | null;
  full_name: string;
};
type AcceptedStaff = { user_id: string; full_name: string; username: string | null };
type TruckOption = { id: string; name: string };
type Mode = "week" | "month";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getMondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = m.getDay();
  m.setDate(m.getDate() + (day === 0 ? -6 : 1 - day));
  return m;
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function toISODate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function fmtShort(d: Date) { return `${DAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; }
function fmtLongDate(s: string | null) {
  if (!s) return "—";
  return new Date(s.includes("T") ? s : s + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(s: string | null) {
  if (!s) return "—";
  const [h, m] = s.split(":");
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${m ?? "00"} ${hour >= 12 ? "PM" : "AM"}`;
}
function timeToMinutes(t: string | null) {
  if (!t) return 0;
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m ?? "0", 10);
}

// Push notification via the shared edge function (matches the web portal pattern).
async function notifyUser(userId: string | null, title: string, body: string, data: Record<string, unknown> = {}) {
  if (!userId) return;
  try { await createClient().functions.invoke("send-push-notification", { body: { userId, title, body, data } }); } catch { /* non-fatal */ }
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: "border-violet-500/40 text-violet-300",
  confirmed: "border-emerald-500/40 text-emerald-300",
  completed: "border-blue-500/40 text-blue-300",
  cancelled: "border-zinc-600 text-zinc-500",
};
const inputCls = "rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors";

// ── Add/Edit shift modal ───────────────────────────────────────────────────
function ShiftModal({ userId, staff, trucks, staffRateMap, existing, initialDate, onSaved, onCancelled, onClose }: {
  userId: string; staff: AcceptedStaff[]; trucks: TruckOption[]; staffRateMap: Record<string, number>;
  existing: Schedule | null; initialDate: string;
  onSaved: (s: Schedule) => void; onCancelled: (id: string) => void; onClose: () => void;
}) {
  const [staffId, setStaffId] = useState(existing?.staff_id ?? "");
  const [shiftDate, setShiftDate] = useState(existing?.shift_date ?? initialDate);
  const [startTime, setStartTime] = useState(existing?.start_time?.slice(0, 5) ?? "09:00");
  const [endTime, setEndTime] = useState(existing?.end_time?.slice(0, 5) ?? "17:00");
  const [role, setRole] = useState(existing?.role ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [truckId, setTruckId] = useState(existing?.truck_id ?? "");
  const [payRate, setPayRate] = useState(existing?.pay_rate != null ? String(existing.pay_rate) : "");
  const [availType, setAvailType] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Availability for the selected staff + date.
  useEffect(() => {
    let cancelled = false;
    if (!staffId || !shiftDate) { setAvailType(null); return; }
    (async () => {
      const { data } = await createClient().from("staff_availability").select("type").eq("staff_id", staffId).eq("date", shiftDate).maybeSingle();
      if (!cancelled) setAvailType((data as any)?.type ?? null);
    })();
    return () => { cancelled = true; };
  }, [staffId, shiftDate]);

  function pickStaff(id: string) {
    setStaffId(id);
    if (!payRate.trim() && staffRateMap[id] != null) setPayRate(String(staffRateMap[id]));
  }

  async function save() {
    if (!staffId || !shiftDate) { setErr("Select a staff member and date"); return; }
    if (startTime && endTime && endTime <= startTime) { setErr("End time must be after start time."); return; }
    setErr(null);
    const supabase = createClient();
    const fullName = staff.find((s) => s.user_id === staffId)?.full_name ?? staffId;

    // Overlap check (advisory).
    const { data: clashRows } = await supabase.from("schedules").select("id, start_time, end_time, status")
      .eq("vendor_id", userId).eq("staff_id", staffId).eq("shift_date", shiftDate).neq("status", "cancelled");
    const ns = timeToMinutes(startTime), ne = timeToMinutes(endTime);
    const clash = ((clashRows ?? []) as any[]).find((r) => (existing ? r.id !== existing.id : true) && ns < timeToMinutes(r.end_time) && timeToMinutes(r.start_time) < ne);
    if (clash) {
      if (!window.confirm(`${fullName} is already scheduled ${fmtTime(clash.start_time)}–${fmtTime(clash.end_time)} on ${fmtLongDate(shiftDate)}. Schedule anyway?`)) return;
    }
    // Availability check (advisory).
    if (availType === "unavailable") {
      if (!window.confirm("This staff member has marked themselves unavailable on this date. Schedule anyway?")) return;
    }

    setSaving(true);
    const payload = {
      vendor_id: userId, staff_id: staffId, shift_date: shiftDate,
      start_time: startTime || null, end_time: endTime || null,
      role: role.trim() || null, notes: notes.trim() || null,
      truck_id: truckId || null, pay_rate: payRate.trim() ? parseFloat(payRate) : null,
      shift_type: "assigned",
    };
    const SELECT = "id, staff_id, shift_date, start_time, end_time, role, notes, status, truck_id, pay_rate";
    const { data, error } = existing
      ? await supabase.from("schedules").update(payload).eq("id", existing.id).select(SELECT).single()
      : await supabase.from("schedules").insert({ ...payload, status: "scheduled" }).select(SELECT).single();
    if (error) { setErr(error.message); setSaving(false); return; }
    await notifyUser(staffId, "New Shift", `You've been scheduled for a shift on ${fmtLongDate(shiftDate)} at ${fmtTime(startTime)}`, { type: "shift_scheduled" });
    onSaved({ ...(data as Omit<Schedule, "full_name">), full_name: fullName });
    onClose();
  }

  async function cancelShift() {
    if (!existing) return;
    if (!window.confirm("Cancel this shift?")) return;
    setCancelling(true);
    const { error } = await createClient().from("schedules").update({ status: "cancelled" }).eq("id", existing.id);
    if (error) { setErr(error.message); setCancelling(false); return; }
    if (existing.staff_id) await notifyUser(existing.staff_id, "Shift Cancelled", `Your shift on ${fmtLongDate(existing.shift_date)} has been cancelled`, { type: "shift_cancelled" });
    onCancelled(existing.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950 p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">{existing ? "Edit Shift" : "Add Shift"}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Staff Member</label>
          <select value={staffId} onChange={(e) => pickStaff(e.target.value)} className={inputCls}>
            <option value="">Select staff…</option>
            {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}{s.username ? ` (@${s.username})` : ""}</option>)}
          </select>
        </div>

        {availType === "unavailable" && (
          <p className="text-xs rounded-lg bg-rose-500/10 text-rose-400 px-3 py-2">⚠️ This staff member has marked themselves unavailable on this date.</p>
        )}
        {availType === "preferred" && (
          <p className="text-xs rounded-lg bg-emerald-500/10 text-emerald-400 px-3 py-2">✅ This is a preferred date for this staff member.</p>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Date</label>
          <input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className={inputCls + " [color-scheme:dark]"} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-500 font-medium">Start Time</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls + " [color-scheme:dark]"} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-500 font-medium">End Time</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls + " [color-scheme:dark]"} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Role</label>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Door Staff, Bar, Security" className={inputCls + " placeholder:text-zinc-600"} />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Truck (optional)</label>
          <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={inputCls}>
            <option value="">No truck</option>
            {trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Pay Rate ($/hr, optional)</label>
          <input type="number" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} placeholder="25.00" className={inputCls + " placeholder:text-zinc-600 [appearance:textfield]"} />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional notes…" className={inputCls + " placeholder:text-zinc-600"} />
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          {existing && existing.status !== "cancelled" && (
            <button onClick={cancelShift} disabled={cancelling}
              className="rounded-xl border border-rose-500/30 text-rose-400 px-4 py-2.5 text-sm font-semibold hover:bg-rose-500/10 transition-colors disabled:opacity-50">
              {cancelling ? "…" : "Cancel Shift"}
            </button>
          )}
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/[0.08] py-2.5 text-sm font-semibold text-zinc-400 hover:text-white transition-colors">Close</button>
          <button onClick={save} disabled={saving || !staffId}
            className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Save" : "Add Shift"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shift card (week view) ───────────────────────────────────────────────────
function ShiftCard({ s, truckMap, onEdit }: { s: Schedule; truckMap: Record<string, string>; onEdit: (s: Schedule) => void }) {
  const cancelled = s.status === "cancelled";
  const truckName = s.truck_id ? truckMap[s.truck_id] : null;
  return (
    <button onClick={() => onEdit(s)}
      className={`w-full text-left rounded-lg bg-white/[0.02] border border-white/[0.06] border-l-2 px-3 py-2.5 hover:bg-white/[0.03] transition-colors ${cancelled ? "opacity-50" : ""}`}
      style={{ borderLeftColor: cancelled ? "#71717a" : "#7C3AED" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white truncate">{s.full_name}</span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[s.status ?? "scheduled"] ?? "border-zinc-600 text-zinc-400"}`}>{s.status ?? "scheduled"}</span>
      </div>
      <p className="text-xs text-zinc-500 mt-0.5">{fmtTime(s.start_time)} → {fmtTime(s.end_time)}{s.role ? ` · ${s.role}` : ""}</p>
      {truckName && <p className="text-xs text-zinc-500 mt-0.5">🚚 {truckName}</p>}
      {s.pay_rate != null && <p className="text-xs font-semibold text-emerald-400 mt-0.5">${Number(s.pay_rate).toFixed(2)}/hr</p>}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(() => getMondayOf(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [acceptedStaff, setAcceptedStaff] = useState<AcceptedStaff[]>([]);
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [truckMap, setTruckMap] = useState<Record<string, string>>({});
  const [staffRateMap, setStaffRateMap] = useState<Record<string, number>>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [modal, setModal] = useState<{ existing: Schedule | null; date: string } | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const today = new Date();
  const range = mode === "month"
    ? (() => { const gs = getMondayOf(monthAnchor); return { from: toISODate(gs), to: toISODate(addDays(gs, 41)) }; })()
    : { from: toISODate(anchor), to: toISODate(addDays(anchor, 6)) };

  // Reference data: active staff, trucks, weekday rates.
  useEffect(() => {
    if (!user) return;
    async function loadRefs() {
      const supabase = createClient();
      const { data: ps } = await supabase.from("promoter_staff").select("user_id").eq("promoter_id", user!.id).eq("status", "active");
      const staffIds = ((ps ?? []) as { user_id: string }[]).map((r) => r.user_id);
      const [spRes, tRes, rRes] = await Promise.all([
        staffIds.length ? supabase.from("staff_profiles").select("user_id, full_name, username").in("user_id", staffIds) : Promise.resolve({ data: [] as any[] }),
        supabase.from("vendor_trucks").select("id, name").eq("vendor_id", user!.id).order("name", { ascending: true }),
        staffIds.length ? supabase.from("staff_pay_rates").select("staff_id, hourly_rate").eq("vendor_id", user!.id).eq("rate_type", "weekday").in("staff_id", staffIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      setAcceptedStaff((spRes.data as AcceptedStaff[]) ?? []);
      setTrucks((tRes.data ?? []) as TruckOption[]);
      const tMap: Record<string, string> = {};
      for (const t of (tRes.data ?? []) as any[]) tMap[t.id] = t.name;
      setTruckMap(tMap);
      const rMap: Record<string, number> = {};
      for (const r of (rRes.data ?? []) as any[]) rMap[r.staff_id] = Number(r.hourly_rate);
      setStaffRateMap(rMap);
    }
    loadRefs();
  }, [user?.id]);

  // Schedules for the visible range.
  const loadSchedules = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("schedules")
      .select("id, staff_id, shift_date, start_time, end_time, role, notes, status, truck_id, pay_rate")
      .eq("vendor_id", user.id).gte("shift_date", range.from).lte("shift_date", range.to)
      .order("shift_date").order("start_time");
    const rows = (data ?? []) as Omit<Schedule, "full_name">[];
    const spMap = Object.fromEntries(acceptedStaff.map((s) => [s.user_id, s.full_name]));
    const unknown = [...new Set(rows.map((r) => r.staff_id).filter((id) => !spMap[id]))];
    if (unknown.length) {
      const { data: extra } = await supabase.from("staff_profiles").select("user_id, full_name").in("user_id", unknown);
      for (const p of (extra ?? []) as { user_id: string; full_name: string }[]) spMap[p.user_id] = p.full_name;
    }
    setSchedules(rows.map((r) => ({ ...r, full_name: spMap[r.staff_id] ?? r.staff_id })));
    setDataLoading(false);
  }, [user?.id, range.from, range.to, acceptedStaff]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  // Reload schedules when the user returns to the tab.
  useEffect(() => {
    const onFocus = () => loadSchedules();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSchedules]);

  function handleSaved(s: Schedule) {
    setSchedules((prev) => {
      const idx = prev.findIndex((x) => x.id === s.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = s; return next; }
      return [...prev, s];
    });
  }
  function handleCancelled(id: string) {
    setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, status: "cancelled" } : s));
  }

  // Month grid
  const gridStart = getMondayOf(monthAnchor);
  const monthCells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const countByDate: Record<string, number> = {};
  for (const s of schedules) if (s.status !== "cancelled") countByDate[s.shift_date] = (countByDate[s.shift_date] ?? 0) + 1;
  const todayStr = toISODate(today);

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  return (
    <>
      {modal && user && (
        <ShiftModal
          userId={user.id} staff={acceptedStaff} trucks={trucks} staffRateMap={staffRateMap}
          existing={modal.existing} initialDate={modal.date}
          onSaved={handleSaved} onCancelled={handleCancelled} onClose={() => setModal(null)}
        />
      )}

      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/team" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <h1 className="text-xl font-bold flex-1">Schedule</h1>
          <button onClick={() => setModal({ existing: null, date: todayStr })} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors">
            + Add Shift
          </button>
        </div>

        {/* Week / Month tabs */}
        <div className="flex gap-2 mb-5">
          {([["week", "Week"], ["month", "Month"]] as [Mode, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === k ? "bg-violet-600 text-white" : "bg-white/[0.04] text-zinc-400 hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>

        {/* ── WEEK ── */}
        {mode === "week" && (
          <>
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => setAnchor((d) => addDays(d, -7))} className="p-2 text-zinc-400 hover:text-white transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span className="text-sm font-medium text-zinc-300">{fmtShort(weekDays[0])} – {fmtShort(weekDays[6])}</span>
              <button onClick={() => setAnchor((d) => addDays(d, 7))} className="p-2 text-zinc-400 hover:text-white transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {weekDays.map((day) => {
                const isToday = sameDay(day, today);
                const dayStr = toISODate(day);
                const daySchedules = schedules.filter((s) => s.shift_date === dayStr);
                return (
                  <div key={dayStr} className={`rounded-2xl border px-4 py-3 ${isToday ? "border-violet-500/40 bg-violet-500/5" : "border-white/[0.06] bg-white/[0.02]"}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${isToday ? "bg-violet-600 text-white" : "bg-white/[0.04] text-zinc-400"}`}>{day.getDate()}</div>
                      <span className={`text-xs font-semibold uppercase tracking-wider ${isToday ? "text-violet-300" : "text-zinc-500"}`}>{DAY[day.getDay()]}</span>
                    </div>
                    {dataLoading ? (
                      <p className="text-xs text-zinc-600">…</p>
                    ) : daySchedules.length === 0 ? (
                      <p className="text-xs text-zinc-600">No shifts</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {daySchedules.map((s) => <ShiftCard key={s.id} s={s} truckMap={truckMap} onEdit={(sh) => setModal({ existing: sh, date: sh.shift_date })} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── MONTH ── */}
        {mode === "month" && (
          <>
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-2 text-zinc-400 hover:text-white transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span className="text-sm font-medium text-zinc-300">{monthAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
              <button onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-2 text-zinc-400 hover:text-white transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="text-[10px] font-semibold text-zinc-500 uppercase py-1">{d}</div>)}
              {dataLoading ? (
                Array.from({ length: 42 }).map((_, i) => <div key={i} className="aspect-square rounded-lg bg-white/[0.02] border border-white/[0.06] animate-pulse" />)
              ) : monthCells.map((d) => {
                const iso = toISODate(d);
                const inMonth = d.getMonth() === monthAnchor.getMonth();
                const isToday = iso === todayStr;
                const count = countByDate[iso] ?? 0;
                return (
                  <button key={iso} onClick={() => { setAnchor(getMondayOf(d)); setMode("week"); }}
                    className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${isToday ? "border-violet-500/50 bg-violet-500/[0.08]" : inMonth ? "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]" : "border-transparent bg-transparent"}`}>
                    <span className={`text-xs ${isToday ? "text-violet-300 font-semibold" : inMonth ? "text-zinc-300" : "text-zinc-700"}`}>{d.getDate()}</span>
                    {count > 0 && <span className="rounded-full bg-violet-600 text-white text-[9px] font-bold min-w-[16px] h-4 px-1 flex items-center justify-center">{count}</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-zinc-600 text-center mt-4">Tap a day to open its week</p>
          </>
        )}
      </div>
    </>
  );
}

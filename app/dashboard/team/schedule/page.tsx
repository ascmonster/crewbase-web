"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type Schedule = {
  id: string;
  staff_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  role: string | null;
  notes: string | null;
  status: string | null;
  full_name: string;
};

type AcceptedStaff = { user_id: string; full_name: string; username: string | null };

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getMondayOf(d: Date): Date {
  const m = new Date(d);
  const day = m.getDay();
  m.setDate(m.getDate() + (day === 0 ? -6 : 1 - day));
  m.setHours(0, 0, 0, 0);
  return m;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtShort(d: Date) {
  return `${DAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

function fmtTime(s: string | null) {
  if (!s) return "—";
  const [h, m] = s.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${m} ${ampm}`;
}

// ── Add/Edit shift modal ───────────────────────────────────────────────────

function ShiftModal({
  userId,
  weekDays,
  acceptedStaff,
  existing,
  onSaved,
  onDeleted,
  onClose,
}: {
  userId: string;
  weekDays: Date[];
  acceptedStaff: AcceptedStaff[];
  existing: Schedule | null;
  onSaved: (s: Schedule) => void;
  onDeleted?: (id: string) => void;
  onClose: () => void;
}) {
  const [staffId, setStaffId] = useState(existing?.staff_id ?? "");
  const [shiftDate, setShiftDate] = useState(existing?.shift_date ?? (weekDays[0]?.toISOString().slice(0, 10) ?? ""));
  const [startTime, setStartTime] = useState(existing?.start_time ?? "09:00");
  const [endTime, setEndTime] = useState(existing?.end_time ?? "17:00");
  const [role, setRole] = useState(existing?.role ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!staffId || !shiftDate) { setErr("Select a staff member and date"); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();

    const payload = {
      vendor_id: userId, staff_id: staffId, shift_date: shiftDate,
      start_time: startTime || null, end_time: endTime || null,
      role: role || null, notes: notes || null, status: "scheduled",
    };

    const staffMember = acceptedStaff.find((s) => s.user_id === staffId);
    const fullName = staffMember?.full_name ?? staffId;

    if (existing) {
      const { data, error } = await supabase.from("schedules").update(payload).eq("id", existing.id)
        .select("id, staff_id, shift_date, start_time, end_time, role, notes, status").single();
      if (error) { setErr(error.message); setSaving(false); return; }
      onSaved({ ...(data as Omit<Schedule, "full_name">), full_name: fullName });
    } else {
      const { data, error } = await supabase.from("schedules").insert(payload)
        .select("id, staff_id, shift_date, start_time, end_time, role, notes, status").single();
      if (error) { setErr(error.message); setSaving(false); return; }
      onSaved({ ...(data as Omit<Schedule, "full_name">), full_name: fullName });
    }
    onClose();
    setSaving(false);
  }

  async function del() {
    if (!existing) return;
    setDeleting(true);
    await createClient().from("schedules").delete().eq("id", existing.id);
    onDeleted?.(existing.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950 p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">{existing ? "Edit Shift" : "Add Shift"}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Staff Member</label>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors">
            <option value="">Select staff…</option>
            {acceptedStaff.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name}{s.username ? ` (@${s.username})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Date</label>
          <select value={shiftDate} onChange={(e) => setShiftDate(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors">
            {weekDays.map((d) => {
              const v = d.toISOString().slice(0, 10);
              return <option key={v} value={v}>{fmtShort(d)}</option>;
            })}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-500 font-medium">Start Time</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-500 font-medium">End Time</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Role</label>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Door Staff, Bar, Security"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors" />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-medium">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional notes…"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors" />
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          {existing && (
            <button onClick={del} disabled={deleting}
              className="rounded-xl border border-rose-500/30 text-rose-400 px-4 py-2.5 text-sm font-semibold hover:bg-rose-500/10 transition-colors disabled:opacity-50">
              {deleting ? "…" : "Delete"}
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-white/[0.08] py-2.5 text-sm font-semibold text-zinc-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !staffId}
            className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Save" : "Add Shift"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [anchor, setAnchor] = useState(() => getMondayOf(new Date()));
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [acceptedStaff, setAcceptedStaff] = useState<AcceptedStaff[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editShift, setEditShift] = useState<Schedule | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const today = new Date();

  // Load accepted staff once
  useEffect(() => {
    if (!user) return;
    async function loadStaff() {
      const supabase = createClient();
      const { data } = await supabase
        .from("promoter_staff")
        .select("user_id")
        // promoter_staff.status is 'pending' or 'active' — 'accepted' was never a
        // stored value, so the picker returned no staff.
        .eq("promoter_id", user!.id)
        .eq("status", "active");
      const userIds = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
      if (userIds.length === 0) return;
      const { data: sp } = await supabase
        .from("staff_profiles")
        .select("user_id, full_name, username")
        .in("user_id", userIds);
      setAcceptedStaff((sp as AcceptedStaff[]) ?? []);
    }
    loadStaff();
  }, [user?.id]);

  // Load schedules for week
  useEffect(() => {
    if (!user) return;
    const startStr = anchor.toISOString().slice(0, 10);
    const endStr = addDays(anchor, 6).toISOString().slice(0, 10);
    setDataLoading(true);

    async function loadSchedules() {
      const supabase = createClient();
      const { data } = await supabase
        .from("schedules")
        .select("id, staff_id, shift_date, start_time, end_time, role, notes, status")
        .eq("vendor_id", user!.id)
        .gte("shift_date", startStr)
        .lte("shift_date", endStr)
        .order("shift_date")
        .order("start_time");

      const rows = (data as Omit<Schedule, "full_name">[]) ?? [];
      // Build name map from accepted staff
      const spMap = Object.fromEntries(acceptedStaff.map((s) => [s.user_id, s.full_name]));

      // For any staff not in accepted list, fetch their profile
      const unknownIds = [...new Set(rows.map((r) => r.staff_id).filter((id) => !spMap[id]))];
      if (unknownIds.length > 0) {
        const { data: extra } = await supabase
          .from("staff_profiles")
          .select("user_id, full_name")
          .in("user_id", unknownIds);
        for (const p of (extra ?? []) as { user_id: string; full_name: string }[]) {
          spMap[p.user_id] = p.full_name;
        }
      }

      setSchedules(rows.map((r) => ({ ...r, full_name: spMap[r.staff_id] ?? r.staff_id })));
      setDataLoading(false);
    }
    loadSchedules();
  }, [user?.id, anchor, acceptedStaff]);

  function handleSaved(s: Schedule) {
    setSchedules((prev) => {
      const idx = prev.findIndex((x) => x.id === s.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = s; return next; }
      return [...prev, s];
    });
  }

  function handleDeleted(id: string) {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  return (
    <>
      {(showAdd || editShift) && user && (
        <ShiftModal
          userId={user.id}
          weekDays={weekDays}
          acceptedStaff={acceptedStaff}
          existing={editShift}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => { setShowAdd(false); setEditShift(null); }}
        />
      )}

      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/team" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <h1 className="text-xl font-bold flex-1">Schedule</h1>
          <button onClick={() => setShowAdd(true)} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors">
            + Add Shift
          </button>
        </div>

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
            const dayStr = day.toISOString().slice(0, 10);
            const daySchedules = schedules.filter((s) => s.shift_date === dayStr);
            return (
              <div key={dayStr} className={`rounded-2xl border px-4 py-3 ${isToday ? "border-violet-500/40 bg-violet-500/5" : "border-white/[0.06] bg-white/[0.02]"}`}>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${isToday ? "bg-violet-600 text-white" : "bg-white/[0.04] text-zinc-400"}`}>
                    {day.getDate()}
                  </div>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${isToday ? "text-violet-300" : "text-zinc-500"}`}>
                    {DAY[day.getDay()]}
                  </span>
                </div>
                {dataLoading ? (
                  <p className="text-xs text-zinc-600 pl-11">…</p>
                ) : daySchedules.length === 0 ? (
                  <p className="text-xs text-zinc-600 pl-11">No shifts</p>
                ) : (
                  <div className="flex flex-col gap-1.5 pl-11">
                    {daySchedules.map((s) => (
                      <button key={s.id} onClick={() => setEditShift(s)}
                        className="flex items-center justify-between text-xs w-full hover:opacity-75 transition-opacity text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-300 font-medium">{s.full_name}</span>
                          {s.role && <span className="text-zinc-600">· {s.role}</span>}
                        </div>
                        <span className="text-zinc-500">{fmtTime(s.start_time)} → {fmtTime(s.end_time)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

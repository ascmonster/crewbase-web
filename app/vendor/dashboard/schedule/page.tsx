"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ────────────────────────────────────────────────────────────────────
type Schedule = {
  id: string;
  staff_id: string | null;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  role: string | null;
  notes: string | null;
  status: string;
  location: string | null;
  pay_rate: number | null;
  is_open: boolean;
  max_staff: number | null;
  visibility: string | null;
  requirements: string | null;
  event_id: string | null;
  truck_id: string | null;
};
type StaffOption = { staff_id: string; full_name: string };
type TruckOption = { id: string; name: string };
type EventOption = { id: string; name: string; location: string | null; start_date: string | null };
type ShiftClaim = { id: string; schedule_id: string; staff_id: string; status: string; claimed_at?: string | null };
type ShiftType = "assigned" | "open" | "event";
type Mode = "week" | "month" | "open";

// Payload the ShiftModal hands back to the page to persist.
type ShiftPayload = {
  id?: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  staff_id: string | null;
  truck_id: string | null;
  event_id: string | null;
  role: string | null;
  location: string | null;
  pay_rate: number | null;
  notes: string | null;
  is_open: boolean;
  max_staff: number | null;
  requirements: string | null;
  visibility: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s.includes("T") ? s : s + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}
function fmtShort(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(t: string | null) {
  if (!t) return "—";
  if (t.includes("T")) return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr % 12 === 0 ? 12 : hr % 12}:${m ?? "00"} ${hr >= 12 ? "PM" : "AM"}`;
}
function timeToMinutes(t: string | null) {
  if (!t) return 0;
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m ?? "0", 10);
}

// Push notification via the shared edge function (same contract as mobile
// notifyUser — the function does the privileged push_tokens read server-side).
async function notifyUser(userId: string | null, title: string, body: string, data: Record<string, unknown> = {}) {
  if (!userId) return;
  try {
    await createClient().functions.invoke("send-push-notification", { body: { userId, title, body, data } });
  } catch { /* non-fatal */ }
}

const STATUS_LEFT: Record<string, string> = {
  scheduled: "#3b82f6", confirmed: "#10b981", completed: "#8b5cf6", cancelled: "#71717a",
};
const STATUS_BADGE: Record<string, string> = {
  scheduled: "border-blue-500/40 text-blue-300",
  confirmed: "border-emerald-500/40 text-emerald-300",
  completed: "border-violet-500/40 text-violet-300",
  cancelled: "border-zinc-600 text-zinc-500",
};

const inputCls = "rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors";
const dateCls = inputCls + " [color-scheme:dark]";
const VISIBILITY_OPTIONS: [string, string][] = [["team", "My Team Only"], ["all", "All Crewbase Staff"]];

// ── Shift modal (add / edit) ─────────────────────────────────────────────────
function ShiftModal({ staff, trucks, events, staffRateMap, existing, defaultDate, onClose, onSave }: {
  staff: StaffOption[]; trucks: TruckOption[]; events: EventOption[]; staffRateMap: Record<string, number>;
  existing: Schedule | null; defaultDate: string;
  onClose: () => void; onSave: (p: ShiftPayload) => Promise<boolean>;
}) {
  const initialType: ShiftType = existing?.is_open ? "open" : existing?.event_id ? "event" : "assigned";
  const [shiftType, setShiftType] = useState<ShiftType>(initialType);
  const [date, setDate] = useState(existing?.shift_date ?? defaultDate);
  const [start, setStart] = useState(existing?.start_time?.slice(0, 5) ?? "");
  const [end, setEnd] = useState(existing?.end_time?.slice(0, 5) ?? "");
  const [staffId, setStaffId] = useState(existing?.staff_id ?? "");
  const [role, setRole] = useState(existing?.role ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [payRate, setPayRate] = useState(existing?.pay_rate != null ? String(existing.pay_rate) : "");
  const [truckId, setTruckId] = useState(existing?.truck_id ?? "");
  const [eventId, setEventId] = useState(existing?.event_id ?? "");
  const [maxStaff, setMaxStaff] = useState(existing?.max_staff != null ? String(existing.max_staff) : "1");
  const [requirements, setRequirements] = useState(existing?.requirements ?? "");
  const [visibility, setVisibility] = useState(existing?.visibility ?? "team");
  const [availMsg, setAvailMsg] = useState<{ kind: "warn" | "hint"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const locked = !!existing; // shift type is locked when editing

  // Availability check for the selected staff + date (assigned / event shifts).
  useEffect(() => {
    let cancelled = false;
    if ((shiftType !== "assigned" && shiftType !== "event") || !staffId || !date) { setAvailMsg(null); return; }
    (async () => {
      const { data } = await createClient().from("staff_availability").select("type").eq("staff_id", staffId).eq("date", date).maybeSingle();
      if (cancelled) return;
      const type = (data as any)?.type;
      const name = staff.find((s) => s.staff_id === staffId)?.full_name ?? "This staff member";
      if (type === "unavailable") setAvailMsg({ kind: "warn", text: `⚠️ ${name} is unavailable on this date` });
      else if (type === "preferred") setAvailMsg({ kind: "hint", text: `✅ This is a preferred date for ${name}` });
      else setAvailMsg(null);
    })();
    return () => { cancelled = true; };
  }, [shiftType, staffId, date, staff]);

  function pickEvent(id: string) {
    setEventId(id);
    const ev = events.find((e) => e.id === id);
    if (ev?.start_date) setDate(ev.start_date.slice(0, 10));
    if (ev?.location) setLocation(ev.location);
  }
  function pickStaff(id: string) {
    setStaffId(id);
    // Pre-fill the pay rate from the staffer's weekday rate when none is set.
    if (!payRate.trim() && staffRateMap[id] != null) setPayRate(String(staffRateMap[id]));
  }

  async function submit() {
    if (!date) { setErr("Date is required."); return; }
    if (start && end && end <= start) { setErr("End time must be after start time."); return; }
    if (shiftType === "event" && !eventId) { setErr("Please select an event."); return; }
    if (shiftType !== "open" && !staffId) { setErr("Please select a staff member."); return; }
    if (shiftType === "open" && (parseInt(maxStaff, 10) || 0) < 1) { setErr("Max staff must be 1 or more."); return; }
    // Advisory confirm when the staffer marked themselves unavailable.
    if (availMsg?.kind === "warn" && !window.confirm("This staff member marked themselves unavailable on this date. Schedule anyway?")) return;
    setErr(null);
    setSaving(true);
    const payload: ShiftPayload = {
      id: existing?.id,
      shift_date: date,
      start_time: start || null,
      end_time: end || null,
      staff_id: shiftType === "open" ? null : (staffId || null),
      truck_id: truckId || null,
      event_id: shiftType === "event" ? (eventId || null) : null,
      role: role.trim() || null,
      location: location.trim() || null,
      pay_rate: payRate.trim() ? parseFloat(payRate) : null,
      notes: notes.trim() || null,
      is_open: shiftType === "open",
      max_staff: shiftType === "open" ? (parseInt(maxStaff, 10) || 1) : null,
      requirements: shiftType === "open" ? (requirements.trim() || null) : null,
      visibility: shiftType === "open" ? visibility : "team",
    };
    const ok = await onSave(payload);
    if (ok === false) setSaving(false); // parent kept the modal open (overlap / error)
  }

  const StaffPicker = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Staff Member</label>
      <div className="flex flex-wrap gap-2">
        {staff.map((s) => (
          <button key={s.staff_id} type="button" onClick={() => pickStaff(s.staff_id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${staffId === s.staff_id ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"}`}>
            {s.full_name}
          </button>
        ))}
        {staff.length === 0 && <span className="text-xs text-zinc-600">No active staff yet.</span>}
      </div>
    </div>
  );
  const TimeFields = (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Start</label>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={dateCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">End</label>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={dateCls} />
      </div>
    </div>
  );
  const RoleField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Role</label>
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Bar Staff, Security" className={inputCls} />
    </div>
  );
  const LocationField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Location</label>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue / area" className={inputCls} />
    </div>
  );
  const PayField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Pay Rate ($/hr)</label>
      <input type="number" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} placeholder="25.00" className={inputCls + " [appearance:textfield]"} />
    </div>
  );
  const TruckField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Truck</label>
      <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={inputCls + " bg-[#141414]"}>
        <option value="">No truck</option>
        {trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  );
  const NotesField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Notes</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls + " resize-none"} />
    </div>
  );
  const DateField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Date</label>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dateCls} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">{existing ? "Edit Shift" : "Add Shift"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {/* Shift type selector — locked on edit */}
          <div className="flex gap-2">
            {(["assigned", "open", "event"] as ShiftType[]).map((t) => (
              <button key={t} type="button" onClick={() => !locked && setShiftType(t)} disabled={locked && shiftType !== t}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold capitalize transition-colors ${shiftType === t ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"} ${locked && shiftType !== t ? "opacity-40" : ""}`}>
                {t}
              </button>
            ))}
          </div>

          {shiftType === "assigned" && (<>{StaffPicker}{DateField}{TimeFields}{RoleField}{LocationField}{PayField}{TruckField}{NotesField}</>)}

          {shiftType === "open" && (
            <>
              {DateField}{TimeFields}{RoleField}{LocationField}{PayField}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Max Staff</label>
                <input type="number" min="1" step="1" value={maxStaff} onChange={(e) => setMaxStaff(e.target.value)} className={inputCls + " [appearance:textfield]"} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Requirements</label>
                <input value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="e.g. RSA required" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Visible To</label>
                <div className="flex flex-col gap-1.5">
                  {VISIBILITY_OPTIONS.map(([val, lbl]) => (
                    <label key={val} className="flex items-center gap-2.5 cursor-pointer">
                      <input type="radio" name="visibility" checked={visibility === val} onChange={() => setVisibility(val)} className="w-4 h-4 accent-[#FF6B35]" />
                      <span className="text-sm text-zinc-300">{lbl}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {shiftType === "event" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Event</label>
                <select value={eventId} onChange={(e) => pickEvent(e.target.value)} className={inputCls + " bg-[#141414]"}>
                  <option value="">Select an event…</option>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
              {StaffPicker}{DateField}{TimeFields}{TruckField}{RoleField}{PayField}{NotesField}
            </>
          )}

          {availMsg && (
            <p className={`text-xs rounded-lg px-3 py-2 ${availMsg.kind === "warn" ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"}`}>{availMsg.text}</p>
          )}
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">{saving ? "Saving…" : existing ? "Update Shift" : "Save Shift"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Claims modal (open shifts) ───────────────────────────────────────────────
function ClaimsModal({ shift, claims, staffMap, busyId, onApprove, onReject, onClose }: {
  shift: Schedule; claims: ShiftClaim[]; staffMap: Record<string, string>; busyId: string | null;
  onApprove: (c: ShiftClaim) => void; onReject: (c: ShiftClaim) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-white">Claims</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          {fmtDate(shift.shift_date)} · {fmtTime(shift.start_time)}–{fmtTime(shift.end_time)}{shift.role ? ` · ${shift.role}` : ""}
        </p>
        {claims.length === 0 ? (
          <p className="text-sm text-zinc-600 py-6 text-center">No one has claimed this shift yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {claims.map((c) => {
              const busy = busyId === c.id;
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{staffMap[c.staff_id] ?? "Unknown"}</p>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${c.status === "approved" ? "text-emerald-400" : c.status === "rejected" ? "text-zinc-500" : "text-zinc-400"}`}>{c.status}</p>
                  </div>
                  {c.status === "pending" && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => onApprove(c)} disabled={busy} className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-600/40 transition-colors disabled:opacity-50">{busy ? "…" : "Approve"}</button>
                      <button onClick={() => onReject(c)} disabled={busy} className="rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 px-2.5 py-1 text-xs font-semibold hover:bg-rose-600/40 transition-colors disabled:opacity-50">Reject</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shift card (week view) ───────────────────────────────────────────────────
function ShiftCard({ shift, staffMap, truckMap, onEdit, onCancel }: {
  shift: Schedule; staffMap: Record<string, string>; truckMap: Record<string, string>;
  onEdit: (s: Schedule) => void; onCancel: (s: Schedule) => void;
}) {
  const cancelled = shift.status === "cancelled";
  const name = shift.is_open ? "Open Shift" : (shift.staff_id ? staffMap[shift.staff_id] ?? "Unassigned" : "Unassigned");
  const truckName = shift.truck_id ? truckMap[shift.truck_id] : null;
  const leftColor = shift.is_open ? "#FF6B35" : (STATUS_LEFT[shift.status] ?? "#71717a");
  return (
    <div className={`rounded-lg bg-white/[0.02] border border-white/[0.06] border-l-2 px-3 py-2.5 ${cancelled ? "opacity-50" : ""}`} style={{ borderLeftColor: leftColor }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white truncate">{shift.is_open ? "🟠 " : ""}{name}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[shift.status] ?? "border-zinc-600 text-zinc-400"}`}>{shift.status}</span>
      </div>
      <p className="text-xs text-zinc-500 mt-1">{fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}</p>
      {shift.role && <p className="text-xs text-zinc-500 mt-0.5">{shift.role}</p>}
      {truckName && <p className="text-xs text-zinc-500 mt-0.5">🚚 {truckName}</p>}
      <div className="flex items-center justify-between mt-2">
        {shift.pay_rate != null ? <span className="text-xs font-semibold text-emerald-400">${Number(shift.pay_rate).toFixed(2)}/hr</span> : <span />}
        {!cancelled && (
          <div className="flex items-center gap-3">
            <button onClick={() => onEdit(shift)} className="text-zinc-500 hover:text-white transition-colors" aria-label="Edit shift">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button onClick={() => onCancel(shift)} className="text-zinc-600 hover:text-rose-400 transition-colors" aria-label="Cancel shift">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function VendorSchedulePage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const vendorId = user?.id ?? "";

  const [mode, setMode] = useState<Mode>("week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [monthStart, setMonthStart] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [openShifts, setOpenShifts] = useState<Schedule[]>([]);
  const [claimsCounts, setClaimsCounts] = useState<Record<string, number>>({});
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [truckMap, setTruckMap] = useState<Record<string, string>>({});
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [staffRateMap, setStaffRateMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [modal, setModal] = useState<{ existing: Schedule | null; date: string } | null>(null);
  const [claimsShift, setClaimsShift] = useState<Schedule | null>(null);
  const [claimsList, setClaimsList] = useState<ShiftClaim[]>([]);
  const [claimBusy, setClaimBusy] = useState<string | null>(null);

  const weekEnd = addDays(weekStart, 6);
  const range = mode === "month"
    ? (() => { const gs = mondayOf(monthStart); return { from: toISODate(gs), to: toISODate(addDays(gs, 41)) }; })()
    : { from: toISODate(weekStart), to: toISODate(weekEnd) };

  // ── Reference data (staff / trucks / events / weekday rates) ──
  const loadRefs = useCallback(async () => {
    if (!vendorId) return;
    const supabase = createClient();
    // Reference data (staff picker, trucks, events, default rates) is all
    // secondary — degrade silently so a failure here doesn't break the page.
    try {
      const { data: sva, error: svaErr } = await supabase
        .from("staff_vendor_assignments").select("staff_id").eq("vendor_id", vendorId).eq("status", "active");
      if (svaErr) throw svaErr;
      const staffIds = [...new Set(((sva ?? []) as any[]).map((r) => r.staff_id).filter(Boolean))];

      const [uRes, tRes, eRes, rRes] = await Promise.all([
        staffIds.length ? supabase.from("users").select("id, full_name").in("id", staffIds) : Promise.resolve({ data: [] as any[], error: null }),
        supabase.from("vendor_trucks").select("id, name").eq("vendor_id", vendorId).order("name", { ascending: true }),
        supabase.from("events").select("id, name, location, start_date").eq("vendor_id", vendorId).in("status", ["upcoming", "active"]).order("start_date", { ascending: true }),
        staffIds.length ? supabase.from("staff_pay_rates").select("staff_id, hourly_rate").eq("vendor_id", vendorId).eq("rate_type", "weekday").in("staff_id", staffIds) : Promise.resolve({ data: [] as any[], error: null }),
      ]);
      if (uRes.error) console.error("[VendorSchedule] staff names failed:", uRes.error.message);
      if (tRes.error) console.error("[VendorSchedule] trucks failed:", tRes.error.message);
      if (eRes.error) console.error("[VendorSchedule] events failed:", eRes.error.message);
      if (rRes.error) console.error("[VendorSchedule] pay rates failed:", rRes.error.message);

      const nameMap: Record<string, string> = {};
      for (const u of (uRes.data ?? []) as any[]) nameMap[u.id] = u.full_name ?? "Unknown";
      setStaff(staffIds.map((id) => ({ staff_id: id, full_name: nameMap[id] ?? "Unknown" })));
      setStaffMap((prev) => ({ ...prev, ...nameMap }));
      setTrucks((tRes.data ?? []) as TruckOption[]);
      const tMap: Record<string, string> = {};
      for (const t of (tRes.data ?? []) as any[]) tMap[t.id] = t.name;
      setTruckMap(tMap);
      setEvents((eRes.data ?? []) as EventOption[]);
      const rMap: Record<string, number> = {};
      for (const r of (rRes.data ?? []) as any[]) rMap[r.staff_id] = Number(r.hourly_rate);
      setStaffRateMap(rMap);
    } catch (e) {
      console.error("[VendorSchedule] reference data load failed:", e instanceof Error ? e.message : e);
    }
  }, [vendorId]);

  // ── Shifts (visible range) + all open shifts ──
  const loadShifts = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    setLoadError(false);
    const supabase = createClient();

    // Primary: schedules in the visible range. A failure here shows the error state.
    try {
      const { data: sched, error } = await supabase.from("schedules").select("*")
        .eq("vendor_id", vendorId).gte("shift_date", range.from).lte("shift_date", range.to).order("start_time", { ascending: true });
      if (error) throw error;
      setSchedules((sched ?? []) as Schedule[]);
    } catch (e) {
      console.error("[VendorSchedule] schedules load failed:", e instanceof Error ? e.message : e);
      setLoadError(true);
      setLoading(false);
      return;
    }

    // Secondary: open shifts + claim counts. Degrade silently so a failure here
    // doesn't blank out the week/month views that already loaded.
    try {
      const { data: open, error: openErr } = await supabase.from("schedules").select("*")
        .eq("vendor_id", vendorId).eq("is_open", true).neq("status", "cancelled")
        .order("shift_date", { ascending: true }).order("start_time", { ascending: true });
      if (openErr) throw openErr;
      const openRows = (open ?? []) as Schedule[];
      setOpenShifts(openRows);

      const openIds = openRows.map((s) => s.id);
      if (openIds.length) {
        const { data: claims, error: claimsErr } = await supabase.from("shift_claims").select("schedule_id, staff_id, status").in("schedule_id", openIds);
        if (claimsErr) console.error("[VendorSchedule] claim counts failed:", claimsErr.message);
        const counts: Record<string, number> = {};
        const extra = new Set<string>();
        for (const c of (claims ?? []) as any[]) { if (c.status === "approved") counts[c.schedule_id] = (counts[c.schedule_id] ?? 0) + 1; extra.add(c.staff_id); }
        setClaimsCounts(counts);
        const unknown = [...extra].filter((id) => !staffMap[id]);
        if (unknown.length) {
          const { data: ex, error: exErr } = await supabase.from("users").select("id, full_name").in("id", unknown);
          if (exErr) console.error("[VendorSchedule] claimant names failed:", exErr.message);
          if (ex?.length) setStaffMap((prev) => { const n = { ...prev }; for (const u of ex as any[]) n[u.id] = u.full_name ?? "Unknown"; return n; });
        }
      } else setClaimsCounts({});
    } catch (e) {
      console.error("[VendorSchedule] open shifts load failed:", e instanceof Error ? e.message : e);
    }
    setLoading(false);
  }, [vendorId, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { loadShifts(); }, [loadShifts]);

  // Reload shifts when the user returns to the tab.
  useEffect(() => {
    const onFocus = () => loadShifts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadShifts]);

  // ── Overlap detection (advisory) ──
  async function findOverlap(staffId: string, shiftDate: string, startTime: string | null, endTime: string | null, ignoreId?: string) {
    if (!staffId) return null;
    const { data } = await createClient().from("schedules").select("id, start_time, end_time, status")
      .eq("vendor_id", vendorId).eq("staff_id", staffId).eq("shift_date", shiftDate).neq("status", "cancelled");
    const ns = timeToMinutes(startTime), ne = timeToMinutes(endTime);
    return ((data ?? []) as any[]).find((s) => (ignoreId ? s.id !== ignoreId : true) && ns < timeToMinutes(s.end_time) && timeToMinutes(s.start_time) < ne) ?? null;
  }

  async function handleSave(p: ShiftPayload): Promise<boolean> {
    const supabase = createClient();
    if (!p.is_open && p.staff_id) {
      const clash = await findOverlap(p.staff_id, p.shift_date, p.start_time, p.end_time, p.id);
      if (clash) {
        const who = staffMap[p.staff_id] ?? "This staff member";
        if (!window.confirm(`${who} is already scheduled ${fmtTime(clash.start_time)}–${fmtTime(clash.end_time)} on ${fmtDate(p.shift_date)}. Schedule anyway?`)) return false;
      }
    }
    const row = {
      staff_id: p.staff_id, shift_date: p.shift_date, start_time: p.start_time, end_time: p.end_time,
      role: p.role, truck_id: p.truck_id, event_id: p.event_id, location: p.location, pay_rate: p.pay_rate,
      notes: p.notes, is_open: p.is_open, max_staff: p.max_staff, requirements: p.requirements, visibility: p.visibility,
      shift_type: p.is_open ? "open" : p.event_id ? "event" : "assigned",
    };
    const { error } = p.id
      ? await supabase.from("schedules").update(row).eq("id", p.id)
      : await supabase.from("schedules").insert({ vendor_id: vendorId, status: "scheduled", ...row });
    if (error) { window.alert(error.message); return false; }

    const dateLabel = fmtDate(p.shift_date);
    if (p.is_open) await Promise.all(staff.map((s) => notifyUser(s.staff_id, "New Open Shift", `New open shift available on ${dateLabel}`, { type: "open_shift" })));
    else if (p.staff_id) await notifyUser(p.staff_id, "New Shift", `You've been scheduled for a shift on ${dateLabel} at ${fmtTime(p.start_time)}`, { type: "shift_scheduled" });

    setModal(null);
    await loadShifts();
    return true;
  }

  async function cancelShift(shift: Schedule) {
    const who = shift.is_open ? "this open shift" : `${shift.staff_id ? staffMap[shift.staff_id] ?? "this staff member" : "this"}'s shift`;
    if (!window.confirm(`Cancel ${who} on ${fmtDate(shift.shift_date)}?`)) return;
    const { error } = await createClient().from("schedules").update({ status: "cancelled" }).eq("id", shift.id);
    if (error) { window.alert(error.message); return; }
    if (shift.staff_id) await notifyUser(shift.staff_id, "Shift Cancelled", `Your shift on ${fmtDate(shift.shift_date)} has been cancelled`, { type: "shift_cancelled" });
    await loadShifts();
  }

  async function copyLastWeek() {
    const supabase = createClient();
    const prevStart = addDays(weekStart, -7);
    const prevEnd = addDays(weekStart, -1);
    const { data: prev, error } = await supabase.from("schedules").select("*")
      .eq("vendor_id", vendorId).gte("shift_date", toISODate(prevStart)).lte("shift_date", toISODate(prevEnd)).in("status", ["scheduled", "confirmed"]);
    if (error) { window.alert(error.message); return; }
    if (!prev || prev.length === 0) { window.alert("No scheduled or confirmed shifts in the previous week."); return; }
    if (!window.confirm(`Duplicate ${prev.length} shift${prev.length !== 1 ? "s" : ""} from last week into this week?`)) return;
    const rows = (prev as any[]).map((s) => ({
      vendor_id: vendorId, staff_id: s.staff_id,
      shift_date: toISODate(addDays(new Date(s.shift_date + "T00:00:00"), 7)),
      start_time: s.start_time, end_time: s.end_time, role: s.role, truck_id: s.truck_id, event_id: s.event_id,
      location: s.location, pay_rate: s.pay_rate, notes: s.notes, is_open: s.is_open, max_staff: s.max_staff,
      requirements: s.requirements, visibility: s.visibility ?? "team", status: "scheduled",
    }));
    const { error: insErr } = await supabase.from("schedules").insert(rows);
    if (insErr) { window.alert(insErr.message); return; }
    await loadShifts();
  }

  // ── Claims ──
  async function openClaims(shift: Schedule) {
    setClaimsShift(shift);
    setClaimsList([]);
    const { data } = await createClient().from("shift_claims")
      .select("id, schedule_id, staff_id, status, claimed_at").eq("schedule_id", shift.id).order("claimed_at", { ascending: true });
    const rows = (data ?? []) as ShiftClaim[];
    setClaimsList(rows);
    const unknown = [...new Set(rows.map((c) => c.staff_id))].filter((id) => !staffMap[id]);
    if (unknown.length) {
      const { data: ex } = await createClient().from("users").select("id, full_name").in("id", unknown);
      if (ex?.length) setStaffMap((prev) => { const n = { ...prev }; for (const u of ex as any[]) n[u.id] = u.full_name ?? "Unknown"; return n; });
    }
  }

  async function approveClaim(claim: ShiftClaim) {
    setClaimBusy(claim.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("schedules").update({ staff_id: claim.staff_id, is_open: false, status: "scheduled" }).eq("id", claim.schedule_id);
      if (error) { window.alert(error.message); return; }
      await supabase.from("shift_claims").update({ status: "approved" }).eq("id", claim.id);
      // Reject sibling pending claims and notify each auto-rejected claimant.
      const { data: siblings } = await supabase.from("shift_claims").select("staff_id").eq("schedule_id", claim.schedule_id).eq("status", "pending").neq("id", claim.id);
      await supabase.from("shift_claims").update({ status: "rejected" }).eq("schedule_id", claim.schedule_id).eq("status", "pending").neq("id", claim.id);
      await Promise.all(((siblings ?? []) as any[]).map((s) => notifyUser(s.staff_id, "Claim Declined", "Another applicant was selected for this shift.", { type: "claim_rejected" })));
      await notifyUser(claim.staff_id, "Shift Confirmed", `You've been approved for the shift on ${claimsShift ? fmtDate(claimsShift.shift_date) : "your shift"}`, { type: "claim_approved" });
      setClaimsShift(null);
      await loadShifts();
    } finally { setClaimBusy(null); }
  }
  async function rejectClaim(claim: ShiftClaim) {
    setClaimBusy(claim.id);
    try {
      await createClient().from("shift_claims").update({ status: "rejected" }).eq("id", claim.id);
      await notifyUser(claim.staff_id, "Claim Declined", "Your claim for a shift was not approved", { type: "claim_rejected" });
      setClaimsList((prev) => prev.map((c) => c.id === claim.id ? { ...c, status: "rejected" } : c));
    } finally { setClaimBusy(null); }
  }

  // ── Derived ──
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const schedulesByDate: Record<string, Schedule[]> = {};
  for (const s of schedules) (schedulesByDate[s.shift_date] ??= []).push(s);
  const gridStart = mondayOf(monthStart);
  const monthCells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayStr = toISODate(new Date());

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center text-zinc-500 text-sm">
          Couldn&apos;t load the schedule. Please refresh to try again.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <h1 className="text-xl font-bold text-white">Schedule</h1>
        <div className="flex items-center gap-2">
          {mode === "week" && (
            <button onClick={copyLastWeek} className="rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-2 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors">
              Copy Last Week
            </button>
          )}
          <button onClick={() => setModal({ existing: null, date: todayStr })} className="flex items-center gap-1.5 rounded-lg bg-[#FF6B35] px-3 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Shift
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {([["week", "Week"], ["month", "Month"], ["open", "Open Shifts"]] as [Mode, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === k ? "bg-[#FF6B35] text-white" : "bg-[#1a1a1a] text-zinc-400 hover:text-white"}`}>
            {l}
            {k === "open" && openShifts.length > 0 && (
              <span className="rounded-full bg-white/20 text-white text-[10px] font-bold min-w-[16px] h-4 px-1 flex items-center justify-center">{openShifts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── WEEK ── */}
      {mode === "week" && (
        <>
          <div className="flex items-center justify-between gap-2 mb-4">
            <button onClick={() => setWeekStart((w) => addDays(w, -7))} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <p className="text-sm font-semibold text-white">{fmtShort(weekStart)} – {fmtShort(weekEnd)}</p>
            <button onClick={() => setWeekStart((w) => addDays(w, 7))} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          {loading ? (
            <div className="flex flex-col gap-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />)}</div>
          ) : (
            <div className="flex flex-col gap-4">
              {days.map((d) => {
                const iso = toISODate(d);
                const isToday = iso === todayStr;
                const dayShifts = schedulesByDate[iso] ?? [];
                return (
                  <div key={iso}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        <span className={isToday ? "text-[#FF6B35]" : "text-zinc-400"}>{d.toLocaleDateString("en-US", { weekday: "long" })}</span>
                        <span className={isToday ? "text-[#FF6B35]" : "text-zinc-600"}>{d.toLocaleDateString("en-US", { day: "numeric", month: "short" })}</span>
                      </p>
                      <button onClick={() => setModal({ existing: null, date: iso })} className="w-6 h-6 rounded-md bg-[#FF6B35]/15 text-[#FF6B35] flex items-center justify-center hover:bg-[#FF6B35]/25 transition-colors">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    </div>
                    {dayShifts.length === 0 ? (
                      <p className="text-xs text-zinc-600 pl-1">No shifts</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {dayShifts.map((s) => (
                          <ShiftCard key={s.id} shift={s} staffMap={staffMap} truckMap={truckMap} onEdit={(sh) => setModal({ existing: sh, date: sh.shift_date })} onCancel={cancelShift} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── MONTH ── */}
      {mode === "month" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <p className="text-sm font-semibold text-white">{monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
            <button onClick={() => setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="text-[10px] font-semibold text-zinc-500 uppercase py-1">{d}</div>)}
            {loading ? (
              Array.from({ length: 42 }).map((_, i) => <div key={i} className="aspect-square rounded-lg bg-white/[0.02] border border-white/[0.06] animate-pulse" />)
            ) : monthCells.map((d) => {
              const iso = toISODate(d);
              const inMonth = d.getMonth() === monthStart.getMonth();
              const isToday = iso === todayStr;
              const count = (schedulesByDate[iso] ?? []).filter((s) => s.status !== "cancelled").length;
              return (
                <button key={iso} onClick={() => { setWeekStart(mondayOf(d)); setMode("week"); }}
                  className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${isToday ? "border-[#FF6B35]/50 bg-[#FF6B35]/[0.08]" : inMonth ? "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]" : "border-transparent bg-transparent"}`}>
                  <span className={`text-xs ${isToday ? "text-[#FF6B35] font-semibold" : inMonth ? "text-zinc-300" : "text-zinc-700"}`}>{d.getDate()}</span>
                  {count > 0 && <span className="rounded-full bg-[#FF6B35] text-white text-[9px] font-bold min-w-[16px] h-4 px-1 flex items-center justify-center">{count}</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-zinc-600 text-center mt-4">Tap a day to open its week</p>
        </>
      )}

      {/* ── OPEN SHIFTS ── */}
      {mode === "open" && (
        loading ? (
          <div className="flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />)}</div>
        ) : openShifts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="text-4xl">🟠</span>
            <p className="text-zinc-400 font-medium">No open shifts</p>
            <p className="text-zinc-600 text-sm max-w-xs">Post an open shift with the + button. Jobs posted via the Jobs tab also appear here for your team to claim.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {openShifts.map((s) => {
              const approved = claimsCounts[s.id] ?? 0;
              const spots = Math.max((s.max_staff ?? 1) - approved, 0);
              return (
                <div key={s.id} className="rounded-xl border border-[#FF6B35]/30 bg-white/[0.02] border-l-2 border-l-[#FF6B35] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{fmtDate(s.shift_date)}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${spots === 0 ? "bg-zinc-500/10 text-zinc-400" : "bg-[#FF6B35]/10 text-[#FF6B35]"}`}>{spots} spot{spots !== 1 ? "s" : ""} left</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}{s.role ? ` · ${s.role}` : ""}</p>
                  {s.location && <p className="text-xs text-zinc-600 mt-0.5">{s.location}</p>}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
                    <button onClick={() => openClaims(s)} className="flex items-center gap-1.5 rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
                      View Claims
                    </button>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setModal({ existing: s, date: s.shift_date })} className="text-zinc-500 hover:text-white transition-colors" aria-label="Edit open shift">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button onClick={() => cancelShift(s)} className="text-zinc-600 hover:text-rose-400 transition-colors" aria-label="Cancel open shift">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {modal && (
        <ShiftModal
          staff={staff} trucks={trucks} events={events} staffRateMap={staffRateMap}
          existing={modal.existing} defaultDate={modal.date}
          onClose={() => setModal(null)} onSave={handleSave}
        />
      )}
      {claimsShift && (
        <ClaimsModal
          shift={claimsShift} claims={claimsList} staffMap={staffMap} busyId={claimBusy}
          onApprove={approveClaim} onReject={rejectClaim} onClose={() => setClaimsShift(null)}
        />
      )}
    </div>
  );
}

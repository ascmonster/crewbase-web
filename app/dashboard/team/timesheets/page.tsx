"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type Shift = {
  id: string;
  staff_id: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  hours_worked: number | null;
  total_pay: number | null;
  hourly_rate: number | null;
  status: string | null;
  payment_status: string | null;
  payment_notes: string | null;
  payment_proof_url: string | null;
  paid_at: string | null;
  approved_at: string | null;
  total_break_minutes: number | null;
  break_deduction_type: string | null;
  event_id: string | null;
  truck_id: string | null;
  staff_profiles: { full_name: string } | null;
  events: { name: string } | null;
  vendor_trucks: { name: string } | null;
};

type NoShowRow = {
  id: string;
  staff_id: string;
  shift_date: string;
  status: string;
  full_name: string;
  user_id: string;
};

type TabKey = "pending" | "approved" | "paid" | "noshows";

function fmtTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Edit Breaks modal ──────────────────────────────────────────────────────

function EditBreaksModal({ shift, onSaved, onClose }: {
  shift: Shift;
  onSaved: (updated: Partial<Shift>) => void;
  onClose: () => void;
}) {
  const [mins, setMins] = useState(String(shift.total_break_minutes ?? 0));
  const [saving, setSaving] = useState(false);

  function preview() {
    if (!shift.clock_in_time || !shift.clock_out_time) return null;
    // rawHours from the clock in/out timestamps, not the stored hours_worked.
    const rawHours = (new Date(shift.clock_out_time).getTime() - new Date(shift.clock_in_time).getTime()) / 3_600_000;
    const breakMins = parseFloat(mins) || 0;
    const newHours = rawHours - breakMins / 60;
    // Use the rate captured at approval; pre-existing shifts derive it once from
    // the original totals (fallback) rather than re-dividing rounded totals.
    const rate = shift.hourly_rate != null
      ? Number(shift.hourly_rate)
      : Number(shift.hours_worked) > 0
        ? parseFloat((Number(shift.total_pay ?? 0) / Number(shift.hours_worked)).toFixed(4))
        : 0;
    const newPay = newHours * rate;
    return { newHours: Math.max(newHours, 0), newPay: Math.max(newPay, 0), rate };
  }

  async function save() {
    const p = preview();
    if (!p) return;
    setSaving(true);
    await createClient().from("shifts").update({
      total_break_minutes: parseFloat(mins) || 0,
      break_deduction_type: "manual",
      hours_worked: p.newHours,
      total_pay: p.newPay,
      hourly_rate: p.rate,
    }).eq("id", shift.id);
    onSaved({ total_break_minutes: parseFloat(mins) || 0, break_deduction_type: "manual", hours_worked: p.newHours, total_pay: p.newPay, hourly_rate: p.rate });
    onClose();
    setSaving(false);
  }

  const p = preview();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Edit Breaks</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex flex-col gap-1.5 mb-4">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Break Duration (minutes)</label>
          <input type="number" value={mins} onChange={(e) => setMins(e.target.value)} min="0"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500 transition-colors" />
        </div>
        {p && (
          <div className="rounded-lg bg-white/[0.03] px-3 py-2.5 mb-4 text-xs text-zinc-400">
            New hours: <span className="text-white font-semibold">{p.newHours.toFixed(2)}h</span>
            {" · "}New pay: <span className="text-white font-semibold">${p.newPay.toFixed(2)}</span>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 h-9 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mark Paid modal ────────────────────────────────────────────────────────

function MarkPaidModal({ shift, userId, onPaid, onClose }: {
  shift: Shift;
  userId: string;
  onPaid: (updated: Partial<Shift>) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const supabase = createClient();
    let proofUrl: string | null = null;

    if (file) {
      const path = `${shift.id}_${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage.from("payment_receipts").upload(path, file, { contentType: file.type });
      if (uploadErr) { setErr(uploadErr.message); setSaving(false); return; }
      const { data: urlData } = supabase.storage.from("payment_receipts").getPublicUrl(path);
      proofUrl = urlData.publicUrl;
    }

    const update: Record<string, unknown> = { payment_status: "paid", paid_at: new Date().toISOString() };
    if (proofUrl) update.payment_proof_url = proofUrl;

    await supabase.from("shifts").update(update).eq("id", shift.id);
    onPaid({ payment_status: "paid", paid_at: new Date().toISOString(), payment_proof_url: proofUrl });
    onClose();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Mark as Paid</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex flex-col gap-1.5 mb-5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Payment Receipt (optional)</label>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-white/[0.06] file:text-white file:text-xs file:font-medium hover:file:bg-white/[0.1] transition-colors" />
        </div>
        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 h-9 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Mark Paid"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shift card ─────────────────────────────────────────────────────────────

function ShiftCard({
  shift,
  tab,
  onApprove,
  onOpenMarkPaid,
  onUpdateBreaks,
  onAddNote,
}: {
  shift: Shift;
  tab: TabKey;
  onApprove?: () => void;
  onOpenMarkPaid?: () => void;
  onUpdateBreaks?: (s: Partial<Shift>) => void;
  onAddNote?: (note: string) => void;
}) {
  const name = shift.staff_profiles?.full_name ?? shift.staff_id;
  const [editingNote, setEditingNote] = useState(false);
  const [noteVal, setNoteVal] = useState(shift.payment_notes ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [editBreaks, setEditBreaks] = useState(false);
  const [markPaid, setMarkPaid] = useState(false);

  async function saveNote() {
    setSavingNote(true);
    await createClient().from("shifts").update({ payment_notes: noteVal || null }).eq("id", shift.id);
    onAddNote?.(noteVal);
    setEditingNote(false);
    setSavingNote(false);
  }

  const dur = (shift.hours_worked ?? 0).toFixed(1);

  return (
    <>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-sm font-bold shrink-0">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm">{name}</p>
            <div className="flex gap-1.5 text-xs text-zinc-500 mt-0.5 flex-wrap">
              <span>{fmtDate(shift.clock_in_time)}</span>
              {shift.events?.name && <><span>·</span><span>{shift.events.name}</span></>}
              {shift.vendor_trucks?.name && <><span>·</span><span>{shift.vendor_trucks.name}</span></>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-bold text-white" style={{ color: "#5B4AE8" }}>${(shift.total_pay ?? 0).toFixed(2)}</p>
            <p className="text-xs text-zinc-500">{dur}h</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500">
            {fmtTime(shift.clock_in_time)} → {fmtTime(shift.clock_out_time)}
            <span className="ml-2 rounded-full bg-white/[0.06] px-1.5 py-0.5 font-medium text-zinc-400">{dur}h</span>
          </span>
          <div className="flex gap-2 flex-wrap justify-end">
            {tab === "pending" && onApprove && (
              <button onClick={onApprove}
                className="rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 px-3 py-1 text-xs font-semibold hover:bg-emerald-600/30 transition-colors">
                Approve
              </button>
            )}
            {tab === "approved" && onOpenMarkPaid && (
              <button onClick={onOpenMarkPaid}
                className="rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 px-3 py-1 text-xs font-semibold hover:bg-indigo-600/30 transition-colors">
                Mark Paid
              </button>
            )}
            {tab === "paid" && shift.payment_proof_url && (
              <a href={shift.payment_proof_url} target="_blank" rel="noopener noreferrer"
                className="rounded-lg border border-white/[0.08] text-zinc-400 px-3 py-1 text-xs font-semibold hover:text-white transition-colors">
                View Receipt
              </a>
            )}
          </div>
        </div>

        {shift.total_break_minutes != null && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-zinc-500">
              Breaks: {shift.total_break_minutes} mins ({shift.break_deduction_type === "manual" ? "manual" : "auto-deducted"})
            </span>
            {tab === "pending" && (
              <button onClick={() => setEditBreaks(true)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
          </div>
        )}
        {tab === "pending" && shift.total_break_minutes == null && (
          <button onClick={() => setEditBreaks(true)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors mb-2">
            + Edit breaks
          </button>
        )}

        {editBreaks && onUpdateBreaks && (
          <EditBreaksModal shift={shift} onSaved={(u) => { onUpdateBreaks(u); setEditBreaks(false); }} onClose={() => setEditBreaks(false)} />
        )}

        {shift.payment_notes && !editingNote && (
          <p className="text-xs text-zinc-500 italic mb-2">{shift.payment_notes}</p>
        )}

        {tab === "pending" && (
          editingNote ? (
            <div className="flex gap-2 mt-2">
              <input value={noteVal} onChange={(e) => setNoteVal(e.target.value)} placeholder="Add payment note…"
                className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors" />
              <button onClick={saveNote} disabled={savingNote} className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">{savingNote ? "…" : "Save"}</button>
              <button onClick={() => { setEditingNote(false); setNoteVal(shift.payment_notes ?? ""); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setEditingNote(true)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
              {shift.payment_notes ? "Edit note" : "+ Add note"}
            </button>
          )
        )}
      </div>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function TimesheetsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [noShows, setNoShows] = useState<NoShowRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [markPaidShift, setMarkPaidShift] = useState<Shift | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();

      const { data: eventData } = await supabase.from("events").select("id").eq("promoter_id", user!.id);
      const eventIds = (eventData ?? []).map((e: { id: string }) => e.id);

      if (eventIds.length > 0) {
        const { data } = await supabase
          .from("shifts")
          .select("id, staff_id, clock_in_time, clock_out_time, hours_worked, total_pay, hourly_rate, status, payment_status, payment_notes, payment_proof_url, paid_at, approved_at, total_break_minutes, break_deduction_type, event_id, truck_id, staff_profiles(full_name), events(name), vendor_trucks(name)")
          .in("event_id", eventIds)
          .eq("status", "completed")
          .order("clock_out_time", { ascending: false });
        setShifts((data as unknown as Shift[]) ?? []);
      }

      // No shows: past scheduled/confirmed schedules
      const today = new Date().toISOString().slice(0, 10);
      const { data: nsData } = await supabase
        .from("schedules")
        .select("id, staff_id, shift_date, status")
        .eq("vendor_id", user!.id)
        .in("status", ["scheduled", "confirmed"])
        .lt("shift_date", today)
        .order("shift_date", { ascending: false });

      const nsRows = (nsData as { id: string; staff_id: string; shift_date: string; status: string }[]) ?? [];
      if (nsRows.length > 0) {
        const staffIds = [...new Set(nsRows.map((r) => r.staff_id))];
        const { data: spData } = await supabase
          .from("staff_profiles")
          .select("user_id, full_name")
          .in("user_id", staffIds);
        const spMap = Object.fromEntries(((spData ?? []) as { user_id: string; full_name: string }[]).map((p) => [p.user_id, p.full_name]));
        setNoShows(nsRows.map((r) => ({ ...r, full_name: spMap[r.staff_id] ?? r.staff_id, user_id: r.staff_id })));
      }

      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  function updateShift(id: string, patch: Partial<Shift>) {
    setShifts((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }

  async function approveShift(id: string) {
    const shift = shifts.find((s) => s.id === id);
    // Capture the effective hourly rate once at approval so later break edits
    // recalc from a fixed rate rather than re-dividing rounded totals (drift).
    const hourly_rate = shift?.hourly_rate != null
      ? Number(shift.hourly_rate)
      : shift && Number(shift.hours_worked) > 0
        ? parseFloat((Number(shift.total_pay ?? 0) / Number(shift.hours_worked)).toFixed(4))
        : 0;
    await createClient().from("shifts").update({ payment_status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id, hourly_rate }).eq("id", id);
    updateShift(id, { payment_status: "approved", approved_at: new Date().toISOString(), hourly_rate });
  }

  async function markNoShow(row: NoShowRow) {
    await createClient().from("schedules").update({ status: "no_show" }).eq("id", row.id);
    await createClient().rpc("increment_no_show_count", { staff_user_id: row.user_id });
    setNoShows((prev) => prev.filter((r) => r.id !== row.id));
  }

  if (authLoading || dataLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const pending  = shifts.filter((s) => !s.payment_status || s.payment_status === "pending");
  const approved = shifts.filter((s) => s.payment_status === "approved");
  const paid     = shifts.filter((s) => s.payment_status === "paid");
  const paidThisMonth = paid.filter((s) => s.paid_at && s.paid_at >= firstOfMonth);

  const pendingAmt  = pending.reduce((sum, s)  => sum + (s.total_pay ?? 0), 0);
  const approvedAmt = approved.reduce((sum, s) => sum + (s.total_pay ?? 0), 0);
  const paidMonthAmt = paidThisMonth.reduce((sum, s) => sum + (s.total_pay ?? 0), 0);

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "pending",  label: "Pending",  count: pending.length },
    { key: "approved", label: "Approved", count: approved.length },
    { key: "paid",     label: "Paid",     count: paid.length },
    { key: "noshows",  label: "No Shows", count: noShows.length },
  ];

  return (
    <>
      {markPaidShift && user && (
        <MarkPaidModal
          shift={markPaidShift}
          userId={user.id}
          onPaid={(u) => { updateShift(markPaidShift.id, u); setMarkPaidShift(null); }}
          onClose={() => setMarkPaidShift(null)}
        />
      )}

      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/team" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <h1 className="text-xl font-bold">Timesheets</h1>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 mb-6 overflow-hidden" style={{ borderLeft: "3px solid rgb(124 58 237 / 0.6)" }}>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Pending",         value: pendingAmt,   color: "text-amber-400" },
              { label: "Approved",        value: approvedAmt,  color: "text-emerald-400" },
              { label: "Paid this month", value: paidMonthAmt, color: "text-indigo-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className={`text-lg font-bold ${color}`}>${value.toFixed(2)}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-0 mb-5 border-b border-white/[0.06]">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.key ? "text-white border-violet-500" : "text-zinc-500 border-transparent hover:text-zinc-300"
              }`}>
              {t.label}
              {t.count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold leading-none ${activeTab === t.key ? "bg-violet-600 text-white" : "bg-white/[0.08] text-zinc-400"}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === "noshows" ? (
          noShows.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center text-zinc-500 text-sm">
              No upcoming no-shows
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {noShows.map((row) => (
                <div key={row.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-sm font-bold shrink-0">
                    {row.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-white text-sm">{row.full_name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{new Date(row.shift_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                  </div>
                  <button onClick={() => markNoShow(row)}
                    className="rounded-lg bg-rose-600/20 text-rose-400 border border-rose-500/20 px-3 py-1 text-xs font-semibold hover:bg-rose-600/30 transition-colors">
                    Mark No Show
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          (() => {
            const list = activeTab === "pending" ? pending : activeTab === "approved" ? approved : paid;
            return list.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center text-zinc-500 text-sm">
                No {TABS.find((t) => t.key === activeTab)?.label.toLowerCase()} timesheets
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {list.map((s) => (
                  <ShiftCard
                    key={s.id}
                    shift={s}
                    tab={activeTab}
                    onApprove={activeTab === "pending" ? () => approveShift(s.id) : undefined}
                    onOpenMarkPaid={activeTab === "approved" ? () => setMarkPaidShift(s) : undefined}
                    onUpdateBreaks={activeTab === "pending" ? (u) => updateShift(s.id, u) : undefined}
                    onAddNote={activeTab === "pending" ? (note) => updateShift(s.id, { payment_notes: note }) : undefined}
                  />
                ))}
              </div>
            );
          })()
        )}
      </div>
    </>
  );
}

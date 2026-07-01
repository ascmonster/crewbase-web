"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────

type StaffRow = {
  staff_id: string;
  full_name: string;
  email: string | null;
  role: string | null;
};

type ScheduleRow = {
  id: string;
  staff_id: string;
  full_name: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
};

type Tab = "staff" | "schedules";

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

const AVATAR_COLORS = [
  "bg-[#FF6B35]/15 text-[#FF6B35]",
  "bg-emerald-500/15 text-emerald-400",
  "bg-indigo-500/15 text-indigo-400",
  "bg-amber-500/15 text-amber-400",
  "bg-rose-500/15 text-rose-400",
  "bg-cyan-500/15 text-cyan-400",
  "bg-violet-500/15 text-violet-400",
];

function hashColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
    : name.charAt(0).toUpperCase();
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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Atoms ──────────────────────────────────────────────────────────────────

function Avatar({ name, colorKey }: { name: string; colorKey: string }) {
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${hashColor(colorKey)}`}>
      {initials(name)}
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-zinc-600">{icon}</div>
      <p className="text-zinc-400 font-medium">{title}</p>
      {sub && <p className="text-zinc-600 text-sm max-w-xs">{sub}</p>}
    </div>
  );
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4 animate-pulse">
          <div className="w-9 h-9 rounded-full bg-white/[0.06]" />
          <div className="flex-1">
            <div className="h-4 w-1/3 rounded bg-white/[0.06] mb-2" />
            <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Schedule row ───────────────────────────────────────────────────────────

function ScheduleCard({ s, onApprove, onReject, busy }: {
  s: ScheduleRow;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{s.full_name}</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {fmtDate(s.shift_date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
        </p>
      </div>
      {s.status.toLowerCase() === "pending" ? (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onApprove(s.id)}
            disabled={busy}
            className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 px-3 py-1 text-xs font-semibold hover:bg-emerald-600/40 transition-colors disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(s.id)}
            disabled={busy}
            className="rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 px-3 py-1 text-xs font-semibold hover:bg-rose-600/40 transition-colors disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : (
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusCls(s.status)}`}>
          {s.status.toUpperCase()}
        </span>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorTeamPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [activeTab, setActiveTab] = useState<Tab>("staff");

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);

  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [schedLoaded, setSchedLoaded] = useState(false);
  const [schedLoading, setSchedLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Staff lazy load ──
  useEffect(() => {
    if (activeTab !== "staff" || staffLoaded || !user) return;
    async function load() {
      setStaffLoading(true);
      const supabase = createClient();
      const uid = user!.id;

      const { data: svaRows } = await supabase
        .from("staff_vendor_assignments")
        .select("staff_id")
        .eq("vendor_id", uid);
      const staffIds = [...new Set(((svaRows ?? []) as { staff_id: string }[]).map((r) => r.staff_id))];

      if (staffIds.length === 0) { setStaff([]); setStaffLoaded(true); setStaffLoading(false); return; }

      const [usersRes, schedRes] = await Promise.all([
        supabase.from("users").select("id, full_name, email").in("id", staffIds),
        supabase
          .from("schedules")
          .select("staff_id, role, shift_date")
          .eq("vendor_id", uid)
          .in("staff_id", staffIds)
          .order("shift_date", { ascending: false }),
      ]);

      const userMap = Object.fromEntries(
        ((usersRes.data ?? []) as { id: string; full_name: string; email: string | null }[]).map((u) => [u.id, u])
      );
      const roleMap: Record<string, string | null> = {};
      for (const s of (schedRes.data ?? []) as { staff_id: string; role: string | null }[]) {
        if (!(s.staff_id in roleMap)) roleMap[s.staff_id] = s.role;
      }

      setStaff(
        staffIds.map((sid) => ({
          staff_id: sid,
          full_name: userMap[sid]?.full_name ?? "Unknown",
          email: userMap[sid]?.email ?? null,
          role: roleMap[sid] ?? null,
        }))
      );
      setStaffLoaded(true);
      setStaffLoading(false);
    }
    load();
  }, [activeTab, staffLoaded, user?.id]);

  // ── Schedules lazy load ──
  useEffect(() => {
    if (activeTab !== "schedules" || schedLoaded || !user) return;
    async function load() {
      setSchedLoading(true);
      const supabase = createClient();
      const uid = user!.id;

      const { data: schedRows } = await supabase
        .from("schedules")
        .select("id, staff_id, shift_date, start_time, end_time, status")
        .eq("vendor_id", uid)
        .order("shift_date", { ascending: true });

      const rows = (schedRows ?? []) as Omit<ScheduleRow, "full_name">[];
      const staffIds = [...new Set(rows.map((r) => r.staff_id))];

      let userMap: Record<string, string> = {};
      if (staffIds.length > 0) {
        const { data: usersRes } = await supabase.from("users").select("id, full_name").in("id", staffIds);
        userMap = Object.fromEntries(((usersRes ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]));
      }

      setSchedules(rows.map((r) => ({ ...r, full_name: userMap[r.staff_id] ?? "Unknown" })));
      setSchedLoaded(true);
      setSchedLoading(false);
    }
    load();
  }, [activeTab, schedLoaded, user?.id]);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    await createClient().from("schedules").update({ status }).eq("id", id);
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    setBusyId(null);
  }

  const loading = authLoading;

  // Group schedules
  const today = todayStr();
  const todaySched = schedules.filter((s) => s.shift_date === today);
  const upcomingSched = schedules.filter((s) => s.shift_date > today);
  const pastSched = schedules.filter((s) => s.shift_date < today).slice().reverse();

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-bold text-white">Team</h1>
        {activeTab === "staff" && staffLoaded && (
          <span className="rounded-full bg-[#FF6B35]/10 px-2.5 py-0.5 text-xs font-semibold text-[#FF6B35]">
            {staff.length}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06]">
        {([["staff", "My Staff"], ["schedules", "Schedules"]] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === key ? "text-white border-[#FF6B35]" : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── My Staff ── */}
      {activeTab === "staff" && (
        loading || staffLoading ? (
          <SkeletonRows count={4} />
        ) : staff.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
            title="No staff yet"
            sub="Staff assigned to you will appear here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {staff.map((s) => (
              <div key={s.staff_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                <Avatar name={s.full_name} colorKey={s.staff_id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white truncate">{s.full_name}</p>
                    {s.role && (
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400 shrink-0">{s.role}</span>
                    )}
                  </div>
                  {s.email && <p className="text-xs text-zinc-500 truncate mt-0.5">{s.email}</p>}
                </div>
                <Link
                  href={`/vendor/dashboard/team/timesheets/${s.staff_id}`}
                  className="shrink-0 rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors"
                >
                  View Timesheets
                </Link>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Schedules ── */}
      {activeTab === "schedules" && (
        loading || schedLoading ? (
          <SkeletonRows count={5} />
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
            title="No schedules yet"
            sub="Shifts you schedule will appear here."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {[["Today", todaySched], ["Upcoming", upcomingSched], ["Past", pastSched]].map(([title, rows]) => {
              const list = rows as ScheduleRow[];
              if (list.length === 0) return null;
              return (
                <div key={title as string}>
                  <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">{title as string}</h2>
                  <div className="flex flex-col gap-3">
                    {list.map((s) => (
                      <ScheduleCard
                        key={s.id}
                        s={s}
                        busy={busyId === s.id}
                        onApprove={(id) => updateStatus(id, "approved")}
                        onReject={(id) => updateStatus(id, "rejected")}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

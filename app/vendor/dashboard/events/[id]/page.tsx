"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";
import { deriveDisplayStatus } from "@/lib/eventStatus";

// ── Types ──────────────────────────────────────────────────────────────────

type EventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
  timezone: string;
  status: string;
  description: string | null;
};

type BroadcastRow = {
  id: string;
  message: string;
  recipient_type: string;
  created_at: string;
};

type TruckRow = { id: string; name: string };

type TxRow = {
  transaction_id: string;
  amount_cents: number;
  net_amount_cents: number | null;
  payment_method: string | null;
  card_last_4?: string | null; // not stored in current schema — rendered only if present
  square_created_at: string | null;
};

type StaffRow = {
  staff_id: string;
  full_name: string;
  email: string | null;
  role: string | null;
  shift_status: string | null;
};

type Tab = "overview" | "revenue" | "staff" | "broadcasts";

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  upcoming:  { label: "UPCOMING",  cls: "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20" },
  active:    { label: "ACTIVE",    cls: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" },
  completed: { label: "COMPLETED", cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" },
  cancelled: { label: "CANCELLED", cls: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20" },
};

const APPROVAL_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  approved: { label: "Approved", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", dot: "bg-emerald-400" },
  pending:  { label: "Pending",  cls: "border-amber-500/30 bg-amber-500/10 text-amber-400",       dot: "bg-amber-400" },
  rejected: { label: "Rejected", cls: "border-rose-500/30 bg-rose-500/10 text-rose-400",          dot: "bg-rose-400" },
};

function statusCfg(status: string) {
  return STATUS_CFG[status.toLowerCase()] ?? { label: status.toUpperCase(), cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" };
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(s: string | null) {
  if (!s) return "";
  const diff = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return fmtDateTime(s);
}

function fmtMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
    : name.charAt(0).toUpperCase();
}

// ── Small UI atoms ─────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-9 h-9 rounded-full bg-[#FF6B35]/15 text-[#FF6B35] flex items-center justify-center text-sm font-bold shrink-0">
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
        <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 animate-pulse">
          <div className="h-4 w-1/3 rounded bg-white/[0.06] mb-2" />
          <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}

// ── Broadcast card ─────────────────────────────────────────────────────────

const RECIPIENT_LABELS: Record<string, string> = { all: "Everyone", vendors: "All Vendors", staff: "Staff Only" };

function BroadcastCard({ b }: { b: BroadcastRow }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="rounded-full bg-[#FF6B35]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#FF6B35]">
          {RECIPIENT_LABELS[b.recipient_type] ?? b.recipient_type}
        </span>
        <span className="text-xs text-zinc-600">{timeAgo(b.created_at)}</span>
      </div>
      <p className="text-sm text-white">{b.message}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireVendorAuth();

  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Core data (loaded on mount)
  const [event, setEvent] = useState<EventRow | null>(null);
  const [approval, setApproval] = useState<string | null>(null);
  const [trucks, setTrucks] = useState<TruckRow[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [coreLoading, setCoreLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Revenue tab (lazy)
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [txLoaded, setTxLoaded] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [txVisible, setTxVisible] = useState(20);

  // Staff tab (lazy)
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);

  // ── Core load ──
  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const uid = user!.id;

      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id, name, location, start_date, end_date, timezone, status, description")
        .eq("id", id)
        .single();

      if (evErr || !ev) { setError("Event not found."); setCoreLoading(false); return; }
      setEvent(ev as EventRow);

      const [approvalRes, vendorTrucksRes, extraTrucksRes, bcastRes] = await Promise.all([
        supabase
          .from("event_vendor_approval")
          .select("status")
          .eq("event_id", id)
          .eq("vendor_id", uid)
          .maybeSingle(),
        supabase
          .from("vendor_trucks")
          .select("id, name")
          .eq("vendor_id", uid),
        supabase
          .from("event_vendor_extra_trucks")
          .select("truck_name")
          .eq("event_id", id)
          .eq("vendor_id", uid),
        supabase
          .from("event_broadcasts")
          .select("id, message, recipient_type, created_at")
          .eq("event_id", id)
          .in("recipient_type", ["all", "vendors"])
          .order("created_at", { ascending: false }),
      ]);

      setApproval((approvalRes.data as { status: string } | null)?.status ?? null);
      setBroadcasts((bcastRes.data as BroadcastRow[]) ?? []);

      // Trucks: this vendor's registered trucks linked to this event, plus per-event extra trucks
      const vendorTrucks = (vendorTrucksRes.data ?? []) as TruckRow[];
      const truckList: TruckRow[] = [];
      if (vendorTrucks.length > 0) {
        const { data: etRows } = await supabase
          .from("event_trucks")
          .select("truck_id")
          .eq("event_id", id)
          .in("truck_id", vendorTrucks.map((t) => t.id));
        const linkedIds = new Set(((etRows ?? []) as { truck_id: string }[]).map((r) => r.truck_id));
        for (const t of vendorTrucks) if (linkedIds.has(t.id)) truckList.push(t);
      }
      for (const [i, r] of ((extraTrucksRes.data ?? []) as { truck_name: string }[]).entries()) {
        truckList.push({ id: `extra-${i}`, name: r.truck_name });
      }
      setTrucks(truckList);

      setCoreLoading(false);
    }
    load();
  }, [user?.id, id]);

  // ── Revenue lazy load ──
  useEffect(() => {
    if (activeTab !== "revenue" || txLoaded || !user) return;
    async function load() {
      setTxLoading(true);
      const { data } = await createClient()
        .from("square_transactions")
        .select("transaction_id, amount_cents, net_amount_cents, payment_method, square_created_at")
        .eq("event_id", id)
        .eq("vendor_id", user!.id)
        .order("square_created_at", { ascending: false });
      setTxRows((data as TxRow[]) ?? []);
      setTxLoaded(true);
      setTxLoading(false);
    }
    load();
  }, [activeTab, txLoaded, user?.id, id]);

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
          .select("staff_id, role, status, shift_date")
          .eq("vendor_id", uid)
          .in("staff_id", staffIds)
          .order("shift_date", { ascending: false }),
      ]);

      const userMap = Object.fromEntries(
        ((usersRes.data ?? []) as { id: string; full_name: string; email: string | null }[]).map((u) => [u.id, u])
      );
      // Latest schedule per staff → role + shift status
      const schedMap: Record<string, { role: string | null; status: string | null }> = {};
      for (const s of (schedRes.data ?? []) as { staff_id: string; role: string | null; status: string | null }[]) {
        if (!schedMap[s.staff_id]) schedMap[s.staff_id] = { role: s.role, status: s.status };
      }

      setStaff(
        staffIds.map((sid) => ({
          staff_id: sid,
          full_name: userMap[sid]?.full_name ?? "Unknown",
          email: userMap[sid]?.email ?? null,
          role: schedMap[sid]?.role ?? null,
          shift_status: schedMap[sid]?.status ?? null,
        }))
      );
      setStaffLoaded(true);
      setStaffLoading(false);
    }
    load();
  }, [activeTab, staffLoaded, user?.id]);

  // ── Render guards ──
  if (authLoading || coreLoading) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="h-4 w-32 rounded bg-white/[0.06] animate-pulse mb-6" />
        <div className="h-24 rounded-2xl bg-white/[0.03] animate-pulse mb-6" />
        <SkeletonRows count={3} />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <Link href="/vendor/dashboard/events" className="text-sm text-zinc-500 hover:text-white transition-colors">← Back to events</Link>
        <div className="flex items-center justify-center h-64">
          <span className="text-red-400 text-sm">{error ?? "Something went wrong."}</span>
        </div>
      </div>
    );
  }

  const display = deriveDisplayStatus(event);
  const { label, cls } = statusCfg(display);
  const totalRevenue = txRows.reduce((s, t) => s + (t.net_amount_cents ?? 0), 0);
  const visibleTx = txRows.slice(0, txVisible);

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview",   label: "Overview" },
    { key: "revenue",    label: "Revenue" },
    { key: "staff",      label: "Staff" },
    { key: "broadcasts", label: "Broadcasts" },
  ];

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Back */}
      <Link
        href="/vendor/dashboard/events"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors mb-5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to events
      </Link>

      {/* Header */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h1 className="text-xl font-bold text-white leading-tight">{event.name}</h1>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 items-center">
          <span>{fmtDate(event.start_date)}</span>
          {event.end_date && event.end_date !== event.start_date && <><span>→</span><span>{fmtDate(event.end_date)}</span></>}
          {event.location && <><span>·</span><span>{event.location}</span></>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab.key ? "text-white border-[#FF6B35]" : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-6">
          {/* Approval status */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Your Approval Status</p>
            {(() => {
              const cfg = approval ? APPROVAL_CFG[approval.toLowerCase()] : null;
              return (
                <div className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 ${cfg?.cls ?? "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"}`}>
                  <span className={`w-2 h-2 rounded-full ${cfg?.dot ?? "bg-zinc-400"}`} />
                  <span className="text-sm font-semibold">{cfg?.label ?? "Not Requested"}</span>
                </div>
              );
            })()}
          </div>

          {/* Trucks */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Your Trucks at This Event</p>
            {trucks.length === 0 ? (
              <p className="text-sm text-zinc-600">No trucks assigned to this event.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {trucks.map((t) => (
                  <span key={t.id} className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-zinc-300">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Broadcasts */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Announcements</p>
            {broadcasts.length === 0 ? (
              <p className="text-sm text-zinc-600">No announcements from the promoter yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {broadcasts.slice(0, 3).map((b) => <BroadcastCard key={b.id} b={b} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Revenue ── */}
      {activeTab === "revenue" && (
        txLoading ? (
          <div className="flex flex-col gap-4">
            <div className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />
            <SkeletonRows count={4} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-6 text-center">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Your Total Revenue</p>
              <p className="text-4xl font-bold text-[#FF6B35]">{fmtMoney(totalRevenue)}</p>
              <p className="text-xs text-zinc-500 mt-2">{txRows.length} transaction{txRows.length !== 1 ? "s" : ""}</p>
            </div>

            {txRows.length === 0 ? (
              <EmptyState
                icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>}
                title="No transactions yet"
                sub="Sales at this event will appear here."
              />
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {visibleTx.map((t) => (
                    <div key={t.transaction_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <p className="text-sm font-medium text-white">{fmtMoney(t.net_amount_cents ?? 0)}</p>
                        <p className="text-xs text-zinc-500">{fmtDateTime(t.square_created_at)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                          {t.payment_method?.toLowerCase() === "cash" ? "Cash" : "Card"}
                        </span>
                        {t.card_last_4 && <span className="text-xs text-zinc-500">•••• {t.card_last_4}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {txVisible < txRows.length && (
                  <button
                    onClick={() => setTxVisible((v) => v + 20)}
                    className="self-center rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-5 py-2 text-sm font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors"
                  >
                    Load more
                  </button>
                )}
              </>
            )}
          </div>
        )
      )}

      {/* ── Staff ── */}
      {activeTab === "staff" && (
        staffLoading ? (
          <SkeletonRows count={4} />
        ) : staff.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
            title="No staff assigned"
            sub="Staff you assign will appear here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {staff.map((s) => (
              <div key={s.staff_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                <Avatar name={s.full_name} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{s.full_name}</p>
                  <p className="text-xs text-zinc-500 truncate">{s.role ?? s.email ?? "—"}</p>
                </div>
                {s.shift_status && (
                  <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    {s.shift_status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Broadcasts ── */}
      {activeTab === "broadcasts" && (
        broadcasts.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>}
            title="No broadcasts yet"
            sub="Messages from the promoter will appear here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {broadcasts.map((b) => <BroadcastCard key={b.id} b={b} />)}
          </div>
        )
      )}
    </div>
  );
}

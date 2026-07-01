"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";
import { deriveDisplayStatus } from "@/lib/eventStatus";

type EventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
  timezone: string;
  status: string;
  displayStatus: string;
  truckCount: number;
  revenue: number; // dollars
};

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  upcoming:  { label: "UPCOMING",  cls: "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20" },
  active:    { label: "ACTIVE",    cls: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" },
  completed: { label: "COMPLETED", cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" },
  cancelled: { label: "CANCELLED", cls: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20" },
};

function statusCfg(status: string) {
  return STATUS_CFG[status.toLowerCase()] ?? { label: status.toUpperCase(), cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" };
}

function fmtDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(dollars: number) {
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Event card ─────────────────────────────────────────────────────────────

function EventCard({ event }: { event: EventRow }) {
  const { label, cls } = statusCfg(event.displayStatus);

  return (
    <Link
      href={`/vendor/dashboard/events/${event.id}`}
      className="group block rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5 transition-colors hover:border-[#FF6B35]/40 hover:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="text-lg font-bold text-white leading-tight group-hover:text-[#FF6B35] transition-colors">
          {event.name}
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
          {label}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-xs text-zinc-500 mb-4">
        <span>{fmtDate(event.start_date)}</span>
        {event.location && <span>{event.location}</span>}
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          {event.truckCount} truck{event.truckCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-[#FF6B35]">
          {fmtMoney(event.revenue)}
        </span>
      </div>
    </Link>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5 animate-pulse">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="h-5 w-40 rounded bg-white/[0.06]" />
        <div className="h-5 w-20 rounded-full bg-white/[0.06]" />
      </div>
      <div className="flex flex-col gap-2 mb-4">
        <div className="h-3 w-24 rounded bg-white/[0.05]" />
        <div className="h-3 w-32 rounded bg-white/[0.05]" />
      </div>
      <div className="flex items-center gap-4">
        <div className="h-3 w-16 rounded bg-white/[0.05]" />
        <div className="h-3 w-16 rounded bg-white/[0.05]" />
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 flex flex-col items-center gap-3 text-center">
      <div className="text-zinc-600">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <p className="text-zinc-400 font-medium">No events yet</p>
      <p className="text-zinc-600 text-sm max-w-xs">You&apos;ll see events here once a promoter adds you to one.</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorEventsPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const uid = user!.id;

      // 1. Events this vendor is associated with
      const { data: evRows } = await supabase
        .from("event_vendors")
        .select("event_id")
        .eq("vendor_id", uid);

      const eventIds = [...new Set(((evRows ?? []) as { event_id: string }[]).map((r) => r.event_id))];

      if (eventIds.length === 0) {
        setEvents([]);
        setDataLoading(false);
        return;
      }

      // 2. Event details + aggregates in parallel
      const [eventsRes, vendorTrucksRes, extraTrucksRes, txRes] = await Promise.all([
        supabase
          .from("events")
          .select("id, name, location, start_date, end_date, timezone, status")
          .in("id", eventIds)
          .order("start_date", { ascending: false }),
        supabase
          .from("vendor_trucks")
          .select("id")
          .eq("vendor_id", uid),
        supabase
          .from("event_vendor_extra_trucks")
          .select("event_id")
          .eq("vendor_id", uid)
          .in("event_id", eventIds),
        supabase
          .from("square_transactions")
          .select("event_id, net_amount_cents")
          .eq("vendor_id", uid)
          .in("event_id", eventIds),
      ]);

      const rawEvents = (eventsRes.data ?? []) as Omit<EventRow, "displayStatus" | "truckCount" | "revenue">[];

      // Trucks: this vendor's registered trucks linked to each event, plus per-event extra trucks
      const vendorTruckIds = ((vendorTrucksRes.data ?? []) as { id: string }[]).map((t) => t.id);
      const truckCountByEvent: Record<string, number> = {};

      if (vendorTruckIds.length > 0) {
        const { data: etRows } = await supabase
          .from("event_trucks")
          .select("event_id, truck_id")
          .in("event_id", eventIds)
          .in("truck_id", vendorTruckIds);
        for (const r of (etRows ?? []) as { event_id: string; truck_id: string }[]) {
          truckCountByEvent[r.event_id] = (truckCountByEvent[r.event_id] ?? 0) + 1;
        }
      }
      for (const r of (extraTrucksRes.data ?? []) as { event_id: string }[]) {
        truckCountByEvent[r.event_id] = (truckCountByEvent[r.event_id] ?? 0) + 1;
      }

      // Revenue per event (net amount for this vendor)
      const revenueByEvent: Record<string, number> = {};
      for (const tx of (txRes.data ?? []) as { event_id: string; net_amount_cents: number | null }[]) {
        revenueByEvent[tx.event_id] = (revenueByEvent[tx.event_id] ?? 0) + (tx.net_amount_cents ?? 0);
      }

      setEvents(
        rawEvents.map((e) => ({
          ...e,
          displayStatus: deriveDisplayStatus(e),
          truckCount: truckCountByEvent[e.id] ?? 0,
          revenue: (revenueByEvent[e.id] ?? 0) / 100,
        }))
      );
      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  const loading = authLoading || dataLoading;

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-xl font-bold text-white">My Events</h1>
        {!loading && (
          <span className="rounded-full bg-[#FF6B35]/10 px-2.5 py-0.5 text-xs font-semibold text-[#FF6B35]">
            {events.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : events.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

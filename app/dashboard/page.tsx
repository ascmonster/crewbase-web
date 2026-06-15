"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string;
  location: string;
  status: string;
  displayStatus: string;
  start_date: string;
  end_date: string;
  timezone: string;
  checkedInCount: number;
  vendorCount: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  active:    { label: "ACTIVE",    cls: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" },
  cancelled: { label: "CANCELLED", cls: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20" },
  completed: { label: "COMPLETED", cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" },
  upcoming:  { label: "UPCOMING",  cls: "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20" },
};

function statusCfg(status: string) {
  return STATUS_CFG[status.toLowerCase()] ?? { label: status.toUpperCase(), cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" };
}

function deriveDisplayStatus(event: { status: string; start_date: string; end_date: string; timezone?: string }): string {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "completed") return "completed";

  const now = new Date();
  const startDate = new Date(event.start_date + "T00:00:00");
  const endDate   = new Date(event.end_date   + "T23:59:59");

  if (now > endDate) return "completed";
  if (now >= startDate && now <= endDate) return "active";

  // start date is today (regardless of current time within the day)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(startDate);
  startDay.setHours(0, 0, 0, 0);
  if (startDay.getTime() === today.getTime()) return "active";

  return "upcoming";
}

function formatEventDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function groupEvents(events: EventRow[]) {
  const todayOrActive: EventRow[] = [];
  const upcoming: EventRow[] = [];
  const past: EventRow[] = [];

  for (const e of events) {
    const s = e.displayStatus;
    if (s === "active") {
      todayOrActive.push(e);
    } else if (s === "upcoming") {
      upcoming.push(e);
    } else {
      past.push(e);
    }
  }

  return { todayOrActive, upcoming, past };
}

// ── Event card ─────────────────────────────────────────────────────────────

function EventCard({ event }: { event: EventRow }) {
  const { label, cls } = statusCfg(event.displayStatus);

  return (
    <Link
      href={`/dashboard/events/${event.id}`}
      className="group block rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 transition-colors hover:border-indigo-500/30 hover:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="font-semibold text-white group-hover:text-indigo-300 transition-colors leading-tight">
          {event.name}
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
          {label}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-xs text-zinc-500 mb-3">
        {event.location && <span>{event.location}</span>}
        <span>{formatEventDate(event.start_date)}</span>
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          {event.checkedInCount} checked in
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
          </svg>
          {event.vendorCount} vendor{event.vendorCount !== 1 ? "s" : ""}
        </span>
      </div>
    </Link>
  );
}

function Section({ title, events }: { title: string; events: EventRow[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
        {title}
      </h2>
      <div className="flex flex-col gap-3">
        {events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();

      const { data: eventsData, error: eventsError } = await supabase
        .from("events")
        .select("id, name, location, status, start_date, end_date, timezone")
        .eq("promoter_id", user!.id)
        .order("start_date", { ascending: false });

      if (eventsError) {
        console.error("[dashboard] events error:", eventsError);
        setDataLoading(false);
        return;
      }

      const rawRows = (eventsData ?? []) as Omit<EventRow, "checkedInCount" | "vendorCount" | "displayStatus">[];
      const ids = rawRows.map((e) => e.id);

      if (ids.length === 0) {
        setEvents([]);
        setDataLoading(false);
        return;
      }

      const [checkinRes, vendorRes] = await Promise.all([
        supabase
          .from("event_checkins")
          .select("event_id")
          .in("event_id", ids),
        supabase
          .from("event_vendors")
          .select("event_id")
          .in("event_id", ids),
      ]);

      const checkinMap = (checkinRes.data ?? []).reduce(
        (acc: Record<string, number>, s: { event_id: string }) => {
          acc[s.event_id] = (acc[s.event_id] ?? 0) + 1;
          return acc;
        },
        {}
      );

      const vendorMap = (vendorRes.data ?? []).reduce(
        (acc: Record<string, number>, v: { event_id: string }) => {
          acc[v.event_id] = (acc[v.event_id] ?? 0) + 1;
          return acc;
        },
        {}
      );

      setEvents(
        rawRows.map((e) => ({
          ...e,
          displayStatus: deriveDisplayStatus(e),
          checkedInCount: checkinMap[e.id] ?? 0,
          vendorCount:    vendorMap[e.id]   ?? 0,
        }))
      );
      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  if (authLoading || dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-zinc-500 text-sm">Loading…</span>
      </div>
    );
  }

  const totalCount    = events.length;
  const activeCount   = events.filter((e) => e.displayStatus === "active").length;
  const upcomingCount = events.filter((e) => e.displayStatus === "upcoming").length;
  const pastCount     = events.filter((e) => e.displayStatus === "completed" || e.displayStatus === "cancelled").length;
  const { todayOrActive, upcoming, past } = groupEvents(events);

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-bold">Events</h1>
        <Link
          href="/dashboard/events/new"
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Event
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
          <p className="text-2xl font-bold text-white">{totalCount}</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Total</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Active</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
          <p className="text-2xl font-bold text-indigo-400">{upcomingCount}</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Upcoming</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
          <p className="text-2xl font-bold text-zinc-400">{pastCount}</p>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Past</p>
        </div>
      </div>

      {/* Grouped events */}
      <Section title="Today / Active" events={todayOrActive} />
      <Section title="Upcoming" events={upcoming} />
      <Section title="Past Events" events={past} />

      {events.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
          <p className="text-zinc-400 font-medium mb-1">No events yet</p>
          <p className="text-zinc-600 text-sm">Create your first event to get started</p>
        </div>
      )}
    </div>
  );
}

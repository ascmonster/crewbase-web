"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";
import { deriveDisplayStatus } from "@/lib/eventStatus";

// ── Types ──────────────────────────────────────────────────────────────────
// NOTE: events.vendor_id is asserted by this screen (vendor-created events) but
// is not referenced elsewhere in the web codebase.

type EventCard = {
  id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
  timezone: string;
  status: string;
  displayStatus: string;
  truck_count: number;
  is_own: boolean;
};

type PendingInvite = {
  event_id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
};

type Truck = { id: string; name: string };

type Tab = "upcoming" | "past";

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  upcoming:  { label: "UPCOMING",  cls: "bg-[#FF6B35]/10 text-[#FF6B35] ring-1 ring-[#FF6B35]/20" },
  active:    { label: "ACTIVE",    cls: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" },
  completed: { label: "COMPLETED", cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" },
  cancelled: { label: "CANCELLED", cls: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20" },
};

function statusCfg(s: string) {
  return STATUS_CFG[s.toLowerCase()] ?? { label: s.toUpperCase(), cls: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20" };
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dateRange(start: string, end: string) {
  if (!end || end === start) return fmtDate(start);
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

// ── Icons ──────────────────────────────────────────────────────────────────

const PinIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
);
const TruckMini = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
);

// ── Event form modal (create / edit) ───────────────────────────────────────

function EventFormModal({ mode, existing, vendorId, vendorTrucks, onClose, onSaved }: {
  mode: "create" | "edit";
  existing: EventCard | null;
  vendorId: string;
  vendorTrucks: Truck[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [startDate, setStartDate] = useState(existing?.start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefill description + truck selection for edit
  useEffect(() => {
    if (mode !== "edit" || !existing) return;
    const supabase = createClient();
    supabase.from("events").select("description").eq("id", existing.id).maybeSingle()
      .then(({ data }: { data: { description: string | null } | null }) => setDescription(data?.description ?? ""));
    const ids = vendorTrucks.map((t) => t.id);
    if (ids.length > 0) {
      supabase.from("event_trucks").select("truck_id").eq("event_id", existing.id).in("truck_id", ids)
        .then(({ data }: { data: { truck_id: string }[] | null }) => setSelected(new Set((data ?? []).map((r) => r.truck_id))));
    }
  }, [mode, existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTruck(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) { setErr("Event name is required."); return; }
    if (!startDate) { setErr("Start date is required."); return; }
    if (endDate && endDate < startDate) { setErr("End date must be on or after the start date."); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();
    const truckIds = [...selected];

    if (mode === "create") {
      const { data, error } = await supabase
        .from("events")
        .insert({
          name: name.trim(),
          location: location.trim() || null,
          description: description.trim() || null,
          start_date: startDate,
          end_date: endDate || startDate,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          status: "upcoming",
          vendor_id: vendorId,
        })
        .select("id")
        .single();
      if (error || !data) { setErr(error?.message ?? "Failed to create event."); setSaving(false); return; }
      if (truckIds.length > 0) {
        await supabase.from("event_trucks").insert(truckIds.map((truck_id) => ({ event_id: data.id, truck_id })));
      }
    } else if (existing) {
      const { error } = await supabase
        .from("events")
        .update({
          name: name.trim(),
          location: location.trim() || null,
          description: description.trim() || null,
          start_date: startDate,
          end_date: endDate || startDate,
        })
        .eq("id", existing.id);
      if (error) { setErr(error.message); setSaving(false); return; }
      const allVendorTruckIds = vendorTrucks.map((t) => t.id);
      if (allVendorTruckIds.length > 0) {
        await supabase.from("event_trucks").delete().eq("event_id", existing.id).in("truck_id", allVendorTruckIds);
      }
      if (truckIds.length > 0) {
        await supabase.from("event_trucks").insert(truckIds.map((truck_id) => ({ event_id: existing.id, truck_id })));
      }
    }

    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/70">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white text-base">{mode === "create" ? "Create Event" : "Edit Event"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <FieldLabel label="Event Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Night Market"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors" />
          </FieldLabel>
          <FieldLabel label="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue / area"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors" />
          </FieldLabel>
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="Start Date">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]" />
            </FieldLabel>
            <FieldLabel label="End Date">
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]" />
            </FieldLabel>
          </div>
          <FieldLabel label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Details for this event…"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors resize-none" />
          </FieldLabel>

          {vendorTrucks.length > 0 && (
            <FieldLabel label="Trucks">
              <div className="flex flex-wrap gap-2">
                {vendorTrucks.map((t) => {
                  const on = selected.has(t.id);
                  return (
                    <button key={t.id} type="button" onClick={() => toggleTruck(t.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${on ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"}`}>
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </FieldLabel>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-3 mt-1">
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {saving ? "Saving…" : mode === "create" ? "Create Event" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorEventsPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const router = useRouter();

  const [events, setEvents] = useState<EventCard[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [vendorTrucks, setVendorTrucks] = useState<Truck[]>([]);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [loading, setLoading] = useState(true);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; existing: EventCard | null } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const uid = user.id;

    const [evRes, ownedRes, truckRes] = await Promise.all([
      supabase.from("event_vendors").select("event_id, status").eq("vendor_id", uid),
      supabase.from("events").select("id, name, location, start_date, end_date, timezone, status").eq("vendor_id", uid),
      supabase.from("vendor_trucks").select("id, name").eq("vendor_id", uid),
    ]);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const evLinks = (evRes.data ?? []) as { event_id: string; status: string }[];
    const owned = (ownedRes.data ?? []) as any[];
    const trucks = (truckRes.data ?? []) as Truck[];
    setVendorTrucks(trucks);

    // Fetch invited events' details
    const invitedIds = evLinks.map((r) => r.event_id);
    let invitedEvents: any[] = [];
    if (invitedIds.length > 0) {
      const { data } = await supabase
        .from("events")
        .select("id, name, location, start_date, end_date, timezone, status")
        .in("id", invitedIds);
      invitedEvents = (data ?? []) as any[];
    }
    const invitedById: Record<string, any> = Object.fromEntries(invitedEvents.map((e) => [e.id, e]));
    const statusByEvent: Record<string, string> = Object.fromEntries(evLinks.map((r) => [r.event_id, r.status]));

    // Pending invites section
    const pending: PendingInvite[] = evLinks
      .filter((r) => r.status === "pending" && invitedById[r.event_id])
      .map((r) => {
        const e = invitedById[r.event_id];
        return { event_id: r.event_id, name: e.name, location: e.location, start_date: e.start_date, end_date: e.end_date };
      });
    setInvites(pending);

    // Tab events: own events + confirmed invited events
    const cards: Record<string, EventCard> = {};
    for (const e of owned) {
      cards[e.id] = { ...e, displayStatus: deriveDisplayStatus(e), truck_count: 0, is_own: true };
    }
    for (const e of invitedEvents) {
      if (statusByEvent[e.id] !== "confirmed") continue;
      if (cards[e.id]) continue; // own takes precedence
      cards[e.id] = { ...e, displayStatus: deriveDisplayStatus(e), truck_count: 0, is_own: false };
    }

    // Truck counts (vendor's trucks linked to each event)
    const eventIds = Object.keys(cards);
    const truckIds = trucks.map((t) => t.id);
    if (eventIds.length > 0 && truckIds.length > 0) {
      const { data: etRows } = await supabase.from("event_trucks").select("event_id, truck_id").in("event_id", eventIds).in("truck_id", truckIds);
      for (const r of (etRows ?? []) as { event_id: string }[]) {
        if (cards[r.event_id]) cards[r.event_id].truck_count += 1;
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    setEvents(Object.values(cards).sort((a, b) => b.start_date.localeCompare(a.start_date)));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  async function respondInvite(eventId: string, status: "confirmed" | "declined") {
    if (status === "declined" && typeof window !== "undefined" && !window.confirm("Decline this invitation?")) return;
    setInviteBusy(eventId);
    await createClient().from("event_vendors").update({ status }).eq("event_id", eventId).eq("vendor_id", user!.id);
    await load();
    setInviteBusy(null);
  }

  const upcoming = events.filter((e) => e.displayStatus === "upcoming" || e.displayStatus === "active");
  const past = events.filter((e) => e.displayStatus === "completed" || e.displayStatus === "cancelled");
  const shown = tab === "upcoming" ? upcoming : past;

  if (authLoading || loading) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="h-8 w-40 rounded bg-white/[0.06] animate-pulse mb-6" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">My Events</h1>
        <button
          onClick={() => setModal({ mode: "create", existing: null })}
          className="flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Event
        </button>
      </div>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
            <p className="text-sm font-semibold text-amber-400">Pending Invites ({invites.length})</p>
          </div>
          <div className="flex flex-col gap-3">
            {invites.map((inv) => (
              <div key={inv.event_id} className="rounded-xl border border-white/[0.06] bg-[#1a1a1a] px-4 py-4">
                <span className="inline-block rounded-full bg-[#FF6B35]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#FF6B35] mb-2">Promoter Event</span>
                <p className="text-sm font-semibold text-white">{inv.name}</p>
                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1">
                  {inv.location && <span className="flex items-center gap-1"><PinIcon />{inv.location}</span>}
                  <span>· {dateRange(inv.start_date, inv.end_date)}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => respondInvite(inv.event_id, "confirmed")}
                    disabled={inviteBusy === inv.event_id}
                    className="rounded-lg bg-[#FF6B35] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50"
                  >
                    {inviteBusy === inv.event_id ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => respondInvite(inv.event_id, "declined")}
                    disabled={inviteBusy === inv.event_id}
                    className="rounded-lg border border-white/[0.12] px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {inviteBusy === inv.event_id ? "…" : "Decline"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {([["upcoming", `Upcoming (${upcoming.length})`], ["past", `Past (${past.length})`]] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab === key ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Event list */}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-zinc-600">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <p className="text-zinc-400 font-medium">No {tab} events</p>
          <p className="text-zinc-600 text-sm max-w-xs">{tab === "upcoming" ? "Create an event or accept an invite to get started." : "Completed and cancelled events will appear here."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((e) => {
            const cfg = statusCfg(e.displayStatus);
            return (
              <div
                key={e.id}
                onClick={() => router.push(`/vendor/dashboard/events/${e.id}`)}
                className="cursor-pointer rounded-2xl bg-white/[0.02] border border-white/[0.06] border-l-4 border-l-[#FF6B35] px-5 py-4 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">{e.name}</p>
                      {!e.is_own && (
                        <span className="rounded-full bg-[#FF6B35]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#FF6B35]">Invited by Promoter</span>
                      )}
                    </div>
                    {e.location && (
                      <span className="flex items-center gap-1 text-xs text-zinc-500 mt-1"><PinIcon />{e.location}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>
                    {e.is_own && (
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setModal({ mode: "edit", existing: e }); }}
                        className="text-zinc-500 hover:text-white transition-colors"
                        aria-label="Edit event"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span>{dateRange(e.start_date, e.end_date)}</span>
                  <span className="flex items-center gap-1"><TruckMini />{e.truck_count} truck{e.truck_count !== 1 ? "s" : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && user && (
        <EventFormModal
          mode={modal.mode}
          existing={modal.existing}
          vendorId={user.id}
          vendorTrucks={vendorTrucks}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

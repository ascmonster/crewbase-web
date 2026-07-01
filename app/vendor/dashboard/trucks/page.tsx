"use client";

import { useEffect, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────
// NOTE: `vendor_trucks.description`/`status`, and the `truck_staff` /
// `pos_device_sessions` tables are not referenced elsewhere in the codebase,
// so their columns are unverified. Rows are read with select("*") and
// normalized defensively to tolerate column-name variance.

type TruckRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  staff_count: number;
  event_count: number;
};

type SquareInfo = {
  connected: boolean;
  merchant_name: string | null;
  location_name: string | null;
};

type PosDevice = {
  id: string;
  device_name: string;
  last_active: string | null;
  status: string | null;
};

type Tab = "trucks" | "pos";

// ── Helpers ────────────────────────────────────────────────────────────────

function truckStatusCls(isActive: boolean) {
  return isActive
    ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
    : "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20";
}

function fmtDateTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normTruck(raw: any): Omit<TruckRow, "staff_count" | "event_count"> {
  return {
    id: raw.id,
    name: raw.name ?? raw.truck_name ?? "Truck",
    description: raw.description ?? null,
    is_active: raw.is_active ?? true,
  };
}

function normDevice(raw: any): PosDevice {
  return {
    id: raw.id ?? raw.device_id ?? String(raw.session_id ?? Math.random()),
    device_name: raw.device_name ?? raw.name ?? raw.device_id ?? "Device",
    last_active: raw.last_active_at ?? raw.last_active ?? raw.last_seen_at ?? raw.updated_at ?? null,
    status: raw.status ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Atoms ──────────────────────────────────────────────────────────────────

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

function TruckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

// ── Add Truck modal ────────────────────────────────────────────────────────

function AddTruckModal({ vendorId, onClose, onAdded }: {
  vendorId: string;
  onClose: () => void;
  onAdded: (t: Omit<TruckRow, "staff_count" | "event_count">) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setErr("Truck name is required."); return; }
    setSaving(true);
    setErr(null);
    const { data, error } = await createClient()
      .from("vendor_trucks")
      .insert({ vendor_id: vendorId, name: name.trim(), description: description.trim() || null, is_active: isActive })
      .select("*")
      .single();
    if (error) { setErr(error.message); setSaving(false); return; }
    onAdded(normTruck(data));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Add Truck</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Truck Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Taco Truck"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Tacos, burritos, and more…"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors resize-none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Is Active</label>
            <div className="flex gap-2">
              {([["Active", true], ["Inactive", false]] as [string, boolean][]).map(([label, val]) => (
                <button key={label} type="button" onClick={() => setIsActive(val)}
                  className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${isActive === val ? "bg-[#FF6B35] text-white" : "border border-white/[0.08] text-zinc-400 hover:text-white"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-3 mt-1">
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {saving ? "Adding…" : "Add Truck"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorTrucksPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [activeTab, setActiveTab] = useState<Tab>("trucks");

  const [trucks, setTrucks] = useState<TruckRow[]>([]);
  const [trucksLoaded, setTrucksLoaded] = useState(false);
  const [trucksLoading, setTrucksLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editActive, setEditActive] = useState(true);

  const [square, setSquare] = useState<SquareInfo | null>(null);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [posLoaded, setPosLoaded] = useState(false);
  const [posLoading, setPosLoading] = useState(false);

  // ── Trucks lazy load ──
  useEffect(() => {
    if (activeTab !== "trucks" || trucksLoaded || !user) return;
    async function load() {
      setTrucksLoading(true);
      const supabase = createClient();
      const uid = user!.id;

      const { data: truckRows } = await supabase
        .from("vendor_trucks")
        .select("*")
        .eq("vendor_id", uid)
        .order("name", { ascending: true });

      const base = ((truckRows ?? []) as unknown[]).map(normTruck);
      const truckIds = base.map((t) => t.id);

      const staffCount: Record<string, number> = {};
      const eventCount: Record<string, number> = {};
      if (truckIds.length > 0) {
        const [staffRes, eventRes] = await Promise.all([
          supabase.from("truck_staff").select("truck_id").in("truck_id", truckIds),
          supabase.from("event_trucks").select("truck_id").in("truck_id", truckIds),
        ]);
        for (const r of (staffRes.data ?? []) as { truck_id: string }[]) staffCount[r.truck_id] = (staffCount[r.truck_id] ?? 0) + 1;
        for (const r of (eventRes.data ?? []) as { truck_id: string }[]) eventCount[r.truck_id] = (eventCount[r.truck_id] ?? 0) + 1;
      }

      setTrucks(base.map((t) => ({ ...t, staff_count: staffCount[t.id] ?? 0, event_count: eventCount[t.id] ?? 0 })));
      setTrucksLoaded(true);
      setTrucksLoading(false);
    }
    load();
  }, [activeTab, trucksLoaded, user?.id]);

  // ── POS lazy load ──
  useEffect(() => {
    if (activeTab !== "pos" || posLoaded || !user) return;
    async function load() {
      setPosLoading(true);
      const supabase = createClient();
      const uid = user!.id;

      const [profileRes, deviceRes] = await Promise.all([
        supabase.from("vendor_profiles").select("square_connected, square_merchant_name, square_location_name").eq("user_id", uid).maybeSingle(),
        supabase.from("pos_device_sessions").select("*").eq("vendor_id", uid),
      ]);

      const p = profileRes.data as { square_connected: boolean | null; square_merchant_name: string | null; square_location_name: string | null } | null;
      setSquare({
        connected: !!p?.square_connected,
        merchant_name: p?.square_merchant_name ?? null,
        location_name: p?.square_location_name ?? null,
      });
      setDevices(((deviceRes.data ?? []) as unknown[]).map(normDevice));
      setPosLoaded(true);
      setPosLoading(false);
    }
    load();
  }, [activeTab, posLoaded, user?.id]);

  async function deleteTruck(id: string) {
    await createClient().from("vendor_trucks").delete().eq("id", id).eq("vendor_id", user!.id);
    setTrucks((prev) => prev.filter((t) => t.id !== id));
    setConfirmDelete(null);
  }

  function startEdit(t: TruckRow) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditDesc(t.description ?? "");
    setEditActive(t.is_active);
  }

  async function saveEdit(id: string) {
    await createClient().from("vendor_trucks").update({ name: editName.trim(), description: editDesc.trim() || null, is_active: editActive }).eq("id", id);
    setTrucks((prev) => prev.map((t) => (t.id === id ? { ...t, name: editName.trim(), description: editDesc.trim() || null, is_active: editActive } : t)));
    setEditingId(null);
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Trucks</h1>
        {activeTab === "trucks" && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Truck
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06]">
        {([["trucks", "My Trucks"], ["pos", "POS Setup"]] as [Tab, string][]).map(([key, label]) => (
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

      {/* ── My Trucks ── */}
      {activeTab === "trucks" && (
        authLoading || trucksLoading ? (
          <SkeletonRows count={3} />
        ) : trucks.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>}
            title="No trucks yet"
            sub="Add a truck to assign staff and take payments."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {trucks.map((t) => (
              <div key={t.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
                {editingId === t.id ? (
                  <div className="flex flex-col gap-3">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors" />
                    <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors resize-none" />
                    <div className="flex gap-2">
                      {([["Active", true], ["Inactive", false]] as [string, boolean][]).map(([label, val]) => (
                        <button key={label} type="button" onClick={() => setEditActive(val)}
                          className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${editActive === val ? "bg-[#FF6B35] text-white" : "border border-white/[0.08] text-zinc-400 hover:text-white"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(t.id)} className="rounded-lg bg-[#FF6B35] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#ff7d4d] transition-colors">Save</button>
                      <button onClick={() => setEditingId(null)} className="rounded-lg border border-white/[0.08] px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <TruckIcon />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white truncate">{t.name}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${truckStatusCls(t.is_active)}`}>
                            {t.is_active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </div>
                        {t.description && <p className="text-xs text-zinc-500 mt-0.5">{t.description}</p>}
                        <div className="flex items-center gap-3 text-xs text-zinc-500 mt-2">
                          <span className="flex items-center gap-1.5">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                            {t.staff_count} staff
                          </span>
                          <span className="flex items-center gap-1.5">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            {t.event_count} event{t.event_count !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button onClick={() => startEdit(t)} className="text-xs text-zinc-500 hover:text-white transition-colors">Edit</button>
                        {confirmDelete === t.id ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => deleteTruck(t.id)} className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors">Confirm</button>
                            <button onClick={() => setConfirmDelete(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(t.id)} className="text-zinc-600 hover:text-rose-400 transition-colors">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── POS Setup ── */}
      {activeTab === "pos" && (
        authLoading || posLoading ? (
          <div className="flex flex-col gap-4">
            <div className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />
            <SkeletonRows count={3} />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Square connection */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Square Integration</p>
                  {square?.connected ? (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Connected
                      </span>
                      {square.merchant_name && <span className="text-xs text-zinc-500">{square.merchant_name}</span>}
                      {square.location_name && <span className="text-xs text-zinc-600">· {square.location_name}</span>}
                    </div>
                  ) : (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400">
                      Not Connected
                    </span>
                  )}
                </div>
                {!square?.connected && user && (
                  <a
                    href={`/api/square/connect?type=vendor&user_id=${user.id}`}
                    className="shrink-0 rounded-lg bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors"
                  >
                    Connect Square
                  </a>
                )}
              </div>
            </div>

            {/* POS devices */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">POS Devices</p>
              {devices.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center">
                  <p className="text-sm text-zinc-500">No POS devices paired.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {devices.map((d) => (
                    <div key={d.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                      <div className="w-9 h-9 rounded-lg bg-[#FF6B35]/15 text-[#FF6B35] flex items-center justify-center shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{d.device_name}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">Last active {fmtDateTime(d.last_active)}</p>
                      </div>
                      {d.status && (
                        <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                          {d.status}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      )}

      {showAdd && user && (
        <AddTruckModal
          vendorId={user.id}
          onClose={() => setShowAdd(false)}
          onAdded={(t) => setTrucks((prev) => [{ ...t, staff_count: 0, event_count: 0 }, ...prev])}
        />
      )}
    </div>
  );
}

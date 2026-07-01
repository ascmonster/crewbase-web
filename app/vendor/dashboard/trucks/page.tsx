"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

/* ────────────────────────────────────────────────────────────────────────────
 * Matches the mobile VendorTrucksScreen (My Fleet).
 * FLAGS: the `create-device-code` and `get-devices` edge functions do not yet
 * exist, and fetching Square locations directly from connect.squareup.com in
 * the browser will hit CORS (a `get-square-locations` edge function exists as
 * the server-side alternative). Built to spec regardless.
 * ──────────────────────────────────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ──────────────────────────────────────────────────────────────────

type Truck = {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  square_location_id: string | null;
  square_location_name: string | null;
  square_terminal_device_id: string | null;
  square_terminal_name: string | null;
};

type VendorSquare = {
  square_connected: boolean;
  square_access_token: string | null;
  square_merchant_name: string | null;
};

type SquareLocation = { id: string; name: string };

const SQUARE_VERSION = "2025-04-16";

function normTruck(raw: any): Truck {
  return {
    id: raw.id,
    name: raw.name ?? raw.truck_name ?? "Truck",
    description: raw.description ?? null,
    photo_url: raw.photo_url ?? null,
    square_location_id: raw.square_location_id ?? null,
    square_location_name: raw.square_location_name ?? null,
    square_terminal_device_id: raw.square_terminal_device_id ?? null,
    square_terminal_name: raw.square_terminal_name ?? null,
  };
}

// ── Atoms ──────────────────────────────────────────────────────────────────

function TruckIcon({ size = 22, color = "#FF6B35" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 rounded-2xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />
      ))}
    </div>
  );
}

// ── Square location picker (inside truck modal) ────────────────────────────

function LocationPicker({ accessToken, current, onPick }: {
  accessToken: string | null;
  current: { id: string | null; name: string | null };
  onPick: (loc: SquareLocation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function fetchLocations() {
    setOpen(true);
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await createClient().functions.invoke("get-square-locations");
      if (error) throw error;
      const locs = ((data?.locations ?? []) as any[]).map((l: any) => ({ id: l.id, name: l.name ?? l.id }));
      setLocations(locs);
    } catch {
      setErr("Could not load Square locations.");
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Square Location</label>
      {current.id ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5">
          <span className="text-sm text-emerald-400 truncate">✓ {current.name ?? current.id}</span>
          <button type="button" onClick={fetchLocations} className="text-xs text-zinc-400 hover:text-white transition-colors">Change</button>
        </div>
      ) : (
        <button type="button" onClick={fetchLocations} className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white text-left hover:border-[#FF6B35] transition-colors">
          Select Square Location
        </button>
      )}

      {open && (
        <div className="rounded-lg border border-white/[0.08] bg-black/30 p-2 max-h-40 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-zinc-500 px-2 py-2">Loading…</p>
          ) : err ? (
            <p className="text-xs text-red-400 px-2 py-2">{err}</p>
          ) : locations.length === 0 ? (
            <p className="text-xs text-zinc-500 px-2 py-2">No locations found.</p>
          ) : (
            locations.map((l) => (
              <button key={l.id} type="button" onClick={() => { onPick(l); setOpen(false); }}
                className="w-full text-left rounded-md px-2 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors">
                {l.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Add / Edit Truck modal ─────────────────────────────────────────────────

function TruckModal({ userId, square, existing, onClose, onSaved, onDeleted }: {
  userId: string;
  square: VendorSquare | null;
  existing: Truck | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(existing?.photo_url ?? null);
  const [locId, setLocId] = useState<string | null>(existing?.square_location_id ?? null);
  const [locName, setLocName] = useState<string | null>(existing?.square_location_name ?? null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onPhoto(f: File | null) {
    setPhotoFile(f);
    if (f) setPhotoPreview(URL.createObjectURL(f));
  }

  async function submit() {
    if (!name.trim()) { setErr("Truck name is required."); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();

    const base = {
      name: name.trim(),
      description: description.trim() || null,
      square_location_id: locId,
      square_location_name: locName,
    };

    let truckId = existing?.id ?? null;
    if (existing) {
      const { error } = await supabase.from("vendor_trucks").update(base).eq("id", existing.id);
      if (error) { setErr(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from("vendor_trucks").insert({ vendor_id: userId, is_active: true, ...base }).select("id").single();
      if (error || !data) { setErr(error?.message ?? "Failed to create truck."); setSaving(false); return; }
      truckId = data.id;
    }

    if (photoFile && truckId) {
      const path = `vendor/${userId}/trucks/${truckId}.jpg`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, photoFile, { upsert: true, contentType: photoFile.type || "image/jpeg" });
      if (!upErr) {
        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
        await supabase.from("vendor_trucks").update({ photo_url: pub.publicUrl }).eq("id", truckId);
      }
    }

    onSaved();
    onClose();
  }

  async function del() {
    if (!existing) return;
    await createClient().from("vendor_trucks").delete().eq("id", existing.id);
    onDeleted(existing.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">{existing ? "Edit Truck" : "Add Truck"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Photo */}
          <div className="flex items-center gap-4">
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-[#FF6B35]/10 flex items-center justify-center shrink-0"><TruckIcon size={26} /></div>
            )}
            <label className="cursor-pointer rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors">
              Upload Photo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0] ?? null)} />
            </label>
          </div>

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

          {square?.square_connected && (
            <LocationPicker
              accessToken={square.square_access_token}
              current={{ id: locId, name: locName }}
              onPick={(l) => { setLocId(l.id); setLocName(l.name); }}
            />
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-3 mt-1">
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {saving ? "Saving…" : existing ? "Save Changes" : "Add Truck"}
            </button>
          </div>

          {existing && (
            confirmDelete ? (
              <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
                <span className="text-xs text-rose-300">Delete this truck?</span>
                <div className="flex gap-3">
                  <button onClick={del} className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors">Confirm</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="self-center text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors">Delete Truck</button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pair Terminal modal ────────────────────────────────────────────────────

function PairTerminalModal({ truck, onClose, onPaired }: {
  truck: Truck;
  onClose: () => void;
  onPaired: (deviceId: string, deviceName: string) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"creating" | "waiting" | "paired" | "error">("creating");
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<{ interval?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout> }>({});

  const cleanup = useCallback(() => {
    if (timers.current.interval) clearInterval(timers.current.interval);
    if (timers.current.timeout) clearTimeout(timers.current.timeout);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const auth = { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` };
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;

      // 1. Create a device code
      try {
        const res = await fetch(`${base}/functions/v1/create-device-code`, {
          method: "POST", headers: auth, body: JSON.stringify({ truck_id: truck.id, name: truck.name }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to create device code");
        const pairingCode = json.code ?? json.device_code ?? json.pair_code;
        const deviceCodeId = json.device_code_id ?? json.id;
        if (cancelled) return;
        setCode(pairingCode ?? "—");
        setStatus("waiting");

        // 2. Poll get-devices every 5s for up to 2 minutes
        let elapsed = 0;
        timers.current.interval = setInterval(async () => {
          elapsed += 5;
          try {
            const dRes = await fetch(`${base}/functions/v1/get-devices`, {
              method: "POST", headers: auth, body: JSON.stringify({ device_code_id: deviceCodeId }),
            });
            const dJson = await dRes.json();
            const devices = (dJson.devices ?? []) as any[];
            const match = devices.find((d) => (d.device_code_id === deviceCodeId || d.pairing_code === pairingCode) && (d.device_id || d.id) && (d.status ? d.status === "PAIRED" : true));
            if (match) {
              cleanup();
              const deviceId = match.device_id ?? match.id;
              const deviceName = match.name ?? match.device_name ?? "Square Terminal";
              await supabase.from("vendor_trucks").update({ square_terminal_device_id: deviceId, square_terminal_name: deviceName }).eq("id", truck.id);
              if (!cancelled) { setStatus("paired"); onPaired(deviceId, deviceName); }
            }
          } catch { /* keep polling */ }
          if (elapsed >= 120) { cleanup(); if (!cancelled && status !== "paired") { setStatus("error"); setErr("Timed out waiting for the terminal to pair."); } }
        }, 5000);
      } catch (e: any) {
        if (!cancelled) { setStatus("error"); setErr(e.message || "Something went wrong"); }
      }
    }
    start();
    return () => { cancelled = true; cleanup(); };
  }, [truck.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6 text-center">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Pair Terminal</h3>
          <button onClick={() => { cleanup(); onClose(); }} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {status === "paired" ? (
          <div className="py-6">
            <p className="text-lg font-semibold text-emerald-400 mb-2">Terminal paired ✓</p>
            <button onClick={onClose} className="mt-2 rounded-lg bg-[#FF6B35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors">Done</button>
          </div>
        ) : status === "error" ? (
          <div className="py-6">
            <p className="text-sm text-red-400 mb-4">{err}</p>
            <button onClick={onClose} className="rounded-lg border border-white/[0.08] px-5 py-2.5 text-sm text-zinc-400 hover:text-white transition-colors">Close</button>
          </div>
        ) : (
          <div className="py-4">
            <p className="text-xs text-zinc-500 mb-4">Enter this code on your Square Terminal</p>
            <p className="text-4xl font-mono font-bold tracking-[0.35em] text-amber-400 mb-4">{status === "creating" ? "····" : code}</p>
            <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Waiting for terminal…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Truck card ─────────────────────────────────────────────────────────────

function TruckCard({ truck, squareConnected, onEdit, onPair, onDisconnect }: {
  truck: Truck;
  squareConnected: boolean;
  onEdit: () => void;
  onPair: () => void;
  onDisconnect: () => void;
}) {
  const locationLinked = !!truck.square_location_id;
  const showTerminal = squareConnected && locationLinked;

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] border-l-4 border-l-[#FF6B35] px-4 py-4">
      <div className="flex items-start gap-3">
        {truck.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={truck.photo_url} alt="" style={{ width: 52, height: 52 }} className="rounded-xl object-cover shrink-0" />
        ) : (
          <div style={{ width: 52, height: 52 }} className="rounded-xl bg-[#FF6B35]/10 flex items-center justify-center shrink-0"><TruckIcon /></div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{truck.name}</p>
          {truck.description && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{truck.description}</p>}

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${locationLinked ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-400"}`}>
              {locationLinked ? "✓ Location linked" : "Square not linked"}
            </span>

            {showTerminal && (
              truck.square_terminal_device_id ? (
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">✓ {truck.square_terminal_name ?? "Terminal"}</span>
                  <button onClick={onDisconnect} className="text-[10px] text-zinc-500 hover:text-rose-400 transition-colors">Disconnect</button>
                </span>
              ) : (
                <button onClick={onPair} className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors">
                  Pair Terminal
                </button>
              )
            )}
          </div>
        </div>

        <button onClick={onEdit} className="text-zinc-500 hover:text-white transition-colors shrink-0" aria-label="Edit truck">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorTrucksPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [square, setSquare] = useState<VendorSquare | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ existing: Truck | null } | null>(null);
  const [pairing, setPairing] = useState<Truck | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const [truckRes, profRes] = await Promise.all([
      supabase.from("vendor_trucks").select("*").eq("vendor_id", user.id).order("name", { ascending: true }),
      supabase.from("vendor_profiles").select("square_connected, square_access_token, square_merchant_name").eq("user_id", user.id).maybeSingle(),
    ]);
    setTrucks(((truckRes.data ?? []) as any[]).map(normTruck));
    const p = profRes.data as any;
    setSquare({
      square_connected: p?.square_connected === true,
      square_access_token: p?.square_access_token ?? null,
      square_merchant_name: p?.square_merchant_name ?? null,
    });
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  async function disconnectTerminal(truck: Truck) {
    await createClient().from("vendor_trucks").update({ square_terminal_device_id: null, square_terminal_name: null }).eq("id", truck.id);
    setTrucks((prev) => prev.map((t) => (t.id === truck.id ? { ...t, square_terminal_device_id: null, square_terminal_name: null } : t)));
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">My Fleet</h1>
        <button
          onClick={() => setModal({ existing: null })}
          className="flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Truck
        </button>
      </div>

      {authLoading || loading ? (
        <SkeletonList />
      ) : trucks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#FF6B35]/10 flex items-center justify-center"><TruckIcon size={30} /></div>
          <p className="text-zinc-300 font-semibold">No Trucks Yet</p>
          <button onClick={() => setModal({ existing: null })} className="mt-2 rounded-xl bg-[#FF6B35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors">
            Add Your First Truck
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {trucks.map((t) => (
            <TruckCard
              key={t.id}
              truck={t}
              squareConnected={square?.square_connected ?? false}
              onEdit={() => setModal({ existing: t })}
              onPair={() => setPairing(t)}
              onDisconnect={() => disconnectTerminal(t)}
            />
          ))}
        </div>
      )}

      {modal && user && (
        <TruckModal
          userId={user.id}
          square={square}
          existing={modal.existing}
          onClose={() => setModal(null)}
          onSaved={load}
          onDeleted={(delId) => setTrucks((prev) => prev.filter((t) => t.id !== delId))}
        />
      )}

      {pairing && (
        <PairTerminalModal
          truck={pairing}
          onClose={() => setPairing(null)}
          onPaired={(deviceId, deviceName) => {
            setTrucks((prev) => prev.map((t) => (t.id === pairing.id ? { ...t, square_terminal_device_id: deviceId, square_terminal_name: deviceName } : t)));
          }}
        />
      )}
    </div>
  );
}

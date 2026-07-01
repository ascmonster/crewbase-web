"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ──────────────────────────────────────────────────────────────────

type Truck = {
  id: string;
  name: string;
  square_location_id: string | null;
  square_location_name: string | null;
};

type TxRow = {
  transaction_id: string;
  amount_cents: number;
  net_amount_cents: number | null;
  payment_method: string | null;
  card_last_4?: string | null;
  square_created_at: string | null;
};

type Tab = "items" | "transactions";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDateTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function CenterState({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="text-zinc-600">{icon}</div>
      <p className="text-zinc-300 font-semibold">{title}</p>
      {sub && <p className="text-zinc-600 text-sm max-w-xs">{sub}</p>}
      {action}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function TruckPosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireVendorAuth();

  const [truck, setTruck] = useState<Truck | null>(null);
  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("items");
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [txLoaded, setTxLoaded] = useState(false);
  const [txLoading, setTxLoading] = useState(false);

  // Core load
  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const [truckRes, profRes] = await Promise.all([
        supabase.from("vendor_trucks").select("id, name, square_location_id, square_location_name").eq("id", id).maybeSingle(),
        supabase.from("vendor_profiles").select("square_connected, square_access_token").eq("user_id", user!.id).maybeSingle(),
      ]);
      if (!truckRes.data) { setError("Truck not found."); setLoading(false); return; }
      setTruck(truckRes.data as Truck);
      setSquareConnected((profRes.data as any)?.square_connected === true);
      setLoading(false);
    }
    load();
  }, [user?.id, id]);

  // Transactions lazy load (filtered by this truck's Square location)
  useEffect(() => {
    if (tab !== "transactions" || txLoaded || !user || !truck) return;
    async function load() {
      setTxLoading(true);
      let query = createClient()
        .from("square_transactions")
        .select("transaction_id, amount_cents, net_amount_cents, payment_method, square_created_at, location_id")
        .eq("vendor_id", user!.id)
        .order("square_created_at", { ascending: false });
      if (truck!.square_location_id) query = query.eq("location_id", truck!.square_location_id);
      const { data } = await query;
      setTxRows((data as TxRow[]) ?? []);
      setTxLoaded(true);
      setTxLoading(false);
    }
    load();
  }, [tab, txLoaded, user?.id, truck]);

  if (authLoading || loading) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="h-4 w-32 rounded bg-white/[0.06] animate-pulse mb-6" />
        <div className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />
      </div>
    );
  }

  if (error || !truck) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <Link href="/vendor/dashboard/trucks" className="text-sm text-zinc-500 hover:text-white transition-colors">← Back to fleet</Link>
        <div className="flex items-center justify-center h-64"><span className="text-red-400 text-sm">{error ?? "Something went wrong."}</span></div>
      </div>
    );
  }

  // Square not connected
  if (!squareConnected) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <Link href="/vendor/dashboard/trucks" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors mb-5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to fleet
        </Link>
        <CenterState
          icon={<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>}
          title="Square Not Connected"
          sub="Connect your Square account to take payments."
          action={<Link href="/vendor/dashboard/settings" className="mt-2 rounded-xl bg-[#FF6B35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors">Connect Square</Link>}
        />
      </div>
    );
  }

  // No Square location linked to this truck
  if (!truck.square_location_id) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <Link href="/vendor/dashboard/trucks" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors mb-5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to fleet
        </Link>
        <CenterState
          icon={<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
          title="No Square location linked"
          sub="Link a Square location to this truck to use POS."
          action={<Link href="/vendor/dashboard/trucks" className="mt-2 rounded-xl bg-[#FF6B35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors">Go to Fleet</Link>}
        />
      </div>
    );
  }

  const totalRevenue = txRows.reduce((s, t) => s + (t.net_amount_cents ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <Link href="/vendor/dashboard/trucks" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors mb-5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to fleet
      </Link>
      <h1 className="text-xl font-bold text-white mb-6">POS — {truck.name}</h1>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06]">
        {([["items", "Items"], ["transactions", "Transactions"]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? "text-white border-[#FF6B35]" : "text-zinc-500 border-transparent hover:text-zinc-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Items — view-only on web */}
      {tab === "items" && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#FF6B35]/10 flex items-center justify-center mb-4">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
          </div>
          <p className="text-sm font-semibold text-white mb-1">Use the mobile app for POS transactions</p>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            {truck.name} is linked to Square location <span className="text-zinc-300">{truck.square_location_name ?? truck.square_location_id}</span>. Web POS is view-only — take payments from the Crewbase mobile app.
          </p>
        </div>
      )}

      {/* Transactions */}
      {tab === "transactions" && (
        txLoading ? (
          <div className="flex flex-col gap-4">
            <div className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />)}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-6 text-center">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Total Revenue</p>
              <p className="text-4xl font-bold text-[#FF6B35]">{fmtMoney(totalRevenue)}</p>
              <p className="text-xs text-zinc-500 mt-2">{txRows.length} transaction{txRows.length !== 1 ? "s" : ""}</p>
            </div>

            {txRows.length === 0 ? (
              <CenterState
                icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>}
                title="No transactions yet"
                sub="Sales at this truck will appear here."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {txRows.map((t) => (
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
            )}
          </div>
        )
      )}
    </div>
  );
}

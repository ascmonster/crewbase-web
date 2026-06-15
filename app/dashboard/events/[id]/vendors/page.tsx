"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type VendorProfile = {
  user_id: string;
  business_name: string;
  username: string | null;
  logo_url: string | null;
};

export default function AddVendorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = use(params);
  const { user, loading: authLoading } = useRequireAuth();

  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [dataLoading, setDataLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();

      const [vendorRes, addedRes] = await Promise.all([
        supabase
          .from("vendor_profiles")
          .select("user_id, business_name, username, logo_url")
          .eq("approval_status", "approved")
          .order("business_name"),
        supabase
          .from("event_vendors")
          .select("vendor_id")
          .eq("event_id", eventId),
      ]);

      setVendors((vendorRes.data as VendorProfile[]) ?? []);
      setAddedIds(new Set((addedRes.data ?? []).map((r: { vendor_id: string }) => r.vendor_id)));
      setDataLoading(false);
    }
    load();
  }, [user?.id, eventId]);

  async function addVendor(vendorId: string) {
    setAdding(vendorId);
    const { error } = await createClient()
      .from("event_vendors")
      .insert({ event_id: eventId, vendor_id: vendorId, status: "pending" });

    if (!error) {
      setAddedIds((prev) => new Set([...prev, vendorId]));
    }
    setAdding(null);
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-zinc-500 text-sm">Loading…</span>
      </div>
    );
  }

  const filtered = vendors.filter((v) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      v.business_name.toLowerCase().includes(q) ||
      (v.username ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
        <Link href="/dashboard" className="hover:text-zinc-300 transition-colors">
          Events
        </Link>
        <span>/</span>
        <Link href={`/dashboard/events/${eventId}`} className="hover:text-zinc-300 transition-colors">
          Event
        </Link>
        <span>/</span>
        <span className="text-zinc-300">Add Vendors</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Add Vendors</h1>
        <Link
          href={`/dashboard/events/${eventId}`}
          className="flex h-9 items-center px-4 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          Done
        </Link>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendors…"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center">
          <p className="text-zinc-400 font-medium">
            {search ? "No vendors match your search" : "No approved vendors found"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((v) => {
            const isAdded = addedIds.has(v.user_id);
            const isAdding = adding === v.user_id;
            return (
              <div
                key={v.user_id}
                className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {v.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.logo_url}
                      alt={v.business_name}
                      className="w-9 h-9 rounded-lg object-cover shrink-0 bg-white/[0.04]"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-indigo-600/20 text-indigo-300 flex items-center justify-center text-sm font-bold shrink-0">
                      {v.business_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{v.business_name}</p>
                    {v.username && (
                      <p className="text-xs text-zinc-500">@{v.username}</p>
                    )}
                  </div>
                </div>

                {isAdded ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Added
                  </span>
                ) : (
                  <button
                    onClick={() => addVendor(v.user_id)}
                    disabled={isAdding}
                    className="shrink-0 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-600/40 transition-colors disabled:opacity-50"
                  >
                    {isAdding ? "…" : "Add"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <Link
          href={`/dashboard/events/${eventId}`}
          className="flex h-10 w-full items-center justify-center rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          Done — View Event
        </Link>
      </div>
    </div>
  );
}

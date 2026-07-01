"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────
// NOTE: `square_transactions` has no stored tip column, so Total Tips renders
// $0.00 (no tip field is queried).

type TxRow = {
  transaction_id: string;
  event_id: string | null;
  amount_cents: number;
  net_amount_cents: number | null;
  payment_method: string | null;
  square_created_at: string | null;
};

type Period = "today" | "week" | "month" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week",  label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all",   label: "All Time" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function periodStart(period: Period): Date | null {
  const now = new Date();
  switch (period) {
    case "today": {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    case "week": {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - day);
      return d;
    }
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "all":
      return null;
  }
}

function fmtMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Atoms ──────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#111] px-4 py-5 text-center">
      <p className="text-2xl font-bold text-[#FF6B35]">{value}</p>
      <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">{children}</h2>;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-[#111] animate-pulse" />)}
      </div>
      <div className="h-64 rounded-2xl bg-[#111] animate-pulse" />
      <div className="h-40 rounded-2xl bg-[#111] animate-pulse" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorAnalyticsPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [allTx, setAllTx] = useState<TxRow[]>([]);
  const [eventNames, setEventNames] = useState<Record<string, string>>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("month");

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const { data: txData } = await supabase
        .from("square_transactions")
        .select("transaction_id, event_id, amount_cents, net_amount_cents, payment_method, square_created_at")
        .eq("vendor_id", user!.id)
        .order("square_created_at", { ascending: true });

      const rows = (txData ?? []) as TxRow[];
      setAllTx(rows);

      const eventIds = [...new Set(rows.map((r) => r.event_id).filter(Boolean))] as string[];
      if (eventIds.length > 0) {
        const { data: evs } = await supabase.from("events").select("id, name").in("id", eventIds);
        setEventNames(Object.fromEntries(((evs ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name])));
      }
      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  // Filter by selected period
  const tx = useMemo(() => {
    const start = periodStart(period);
    if (!start) return allTx;
    const startMs = start.getTime();
    return allTx.filter((t) => t.square_created_at && new Date(t.square_created_at).getTime() >= startMs);
  }, [allTx, period]);

  // Derived metrics
  const totalRevenue = tx.reduce((s, t) => s + (t.net_amount_cents ?? 0), 0);
  const count = tx.length;
  const avg = count > 0 ? totalRevenue / count : 0;

  const byDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tx) {
      if (!t.square_created_at) continue;
      const day = t.square_created_at.slice(0, 10);
      map[day] = (map[day] ?? 0) + (t.net_amount_cents ?? 0);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, cents]) => ({ day: fmtDayLabel(day), amount: +(cents / 100).toFixed(2) }));
  }, [tx]);

  const topEvents = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tx) {
      if (!t.event_id) continue;
      map[t.event_id] = (map[t.event_id] ?? 0) + (t.net_amount_cents ?? 0);
    }
    const ranked = Object.entries(map)
      .map(([id, cents]) => ({ id, name: eventNames[id] ?? "Event", cents }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 5);
    const max = ranked[0]?.cents ?? 0;
    return ranked.map((r) => ({ ...r, pct: max > 0 ? (r.cents / max) * 100 : 0 }));
  }, [tx, eventNames]);

  const paymentMethods = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tx) {
      const key = t.payment_method?.toLowerCase() === "cash" ? "Cash" : "Card";
      map[key] = (map[key] ?? 0) + 1;
    }
    return ["Card", "Cash"]
      .filter((k) => map[k])
      .map((k) => ({ method: k, count: map[k], pct: count > 0 ? (map[k] / count) * 100 : 0 }));
  }, [tx, count]);

  if (authLoading || dataLoading) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <h1 className="text-xl font-bold text-white mb-6">Analytics</h1>
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <h1 className="text-xl font-bold text-white mb-5">Analytics</h1>

      {/* Period filter */}
      <div className="flex gap-2 mb-8 overflow-x-auto scrollbar-none">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              period === p.key ? "bg-[#FF6B35] text-white" : "border border-white/[0.08] text-zinc-400 hover:text-white"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {count === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-[#111] px-6 py-16 flex flex-col items-center gap-3 text-center">
          <div className="text-zinc-600">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
          </div>
          <p className="text-zinc-400 font-medium">No transaction data yet</p>
          <p className="text-zinc-600 text-sm max-w-xs">Sales for this period will show up here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Revenue Summary */}
          <section>
            <SectionTitle>Revenue Summary</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Revenue" value={fmtMoney(totalRevenue)} />
              <StatCard label="Transactions" value={String(count)} />
              <StatCard label="Avg Transaction" value={fmtMoney(avg)} />
              <StatCard label="Total Tips" value={fmtMoney(0)} />
            </div>
          </section>

          {/* Revenue Over Time */}
          <section>
            <SectionTitle>Revenue Over Time</SectionTitle>
            <div className="rounded-2xl border border-white/[0.06] bg-[#111] px-3 py-5">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byDay} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                  <YAxis
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${v}`}
                    width={48}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,107,53,0.08)" }}
                    contentStyle={{ background: "#141414", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, color: "#fff", fontSize: 12 }}
                    formatter={(v) => [`$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Revenue"]}
                  />
                  <Bar dataKey="amount" fill="#FF6B35" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Top Events by Revenue */}
          <section>
            <SectionTitle>Top Events by Revenue</SectionTitle>
            {topEvents.length === 0 ? (
              <p className="text-sm text-zinc-600">No event-linked transactions.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {topEvents.map((e, i) => (
                  <div key={e.id} className="rounded-xl border border-white/[0.06] bg-[#111] px-4 py-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-zinc-600 w-4 shrink-0">{i + 1}</span>
                        <p className="text-sm font-semibold text-white truncate">{e.name}</p>
                      </div>
                      <span className="text-sm font-semibold text-[#FF6B35] shrink-0">{fmtMoney(e.cents)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full bg-[#FF6B35]" style={{ width: `${e.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Payment Methods */}
          <section>
            <SectionTitle>Payment Methods</SectionTitle>
            <div className="flex flex-col gap-3">
              {paymentMethods.map((p) => (
                <div key={p.method} className="rounded-xl border border-white/[0.06] bg-[#111] px-4 py-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-white">{p.method}</p>
                    <span className="text-xs text-zinc-400">
                      {p.count} · {p.pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                    <div className="h-full rounded-full bg-[#FF6B35]" style={{ width: `${p.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

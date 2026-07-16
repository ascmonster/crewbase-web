"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";
import AwardRateGuide from "@/components/AwardRateGuide";
import { calculateAge } from "@/lib/getAwardRates";

type PromoterStaff = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  full_name: string;
  email: string | null;
  username: string | null;
  avg_stars: number | null;
};

type StaffProfileResult = {
  id: string;
  user_id: string;
  full_name: string;
  username: string | null;
};

type PayRateRow = { rate_type: string; hourly_rate: number };
type DefaultPayRate = { base_rate: number | null; saturday_rate: number | null; public_holiday_rate: number | null };

function Stars({ rating }: { rating: number | null }) {
  const r = Math.round(rating ?? 0);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 24 24"
          fill={i < r ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5"
          className={i < r ? "text-amber-400" : "text-zinc-700"}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ))}
    </div>
  );
}

// ── Invite modal ───────────────────────────────────────────────────────────

function InviteModal({ promoterId, onInvited, onClose }: {
  promoterId: string;
  onInvited: (s: PromoterStaff) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StaffProfileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setErr(null);
    const q = query.trim();
    const supabase = createClient();

    const { data: byUsername } = await supabase
      .from("staff_profiles")
      .select("id, user_id, full_name, username")
      .ilike("username", `%${q}%`)
      .limit(10);

    if ((byUsername ?? []).length > 0) {
      setResults((byUsername as StaffProfileResult[]) ?? []);
      setSearching(false);
      return;
    }

    // Fallback: email search via users → staff_profiles
    const { data: userRow } = await supabase
      .from("users")
      .select("id")
      .eq("email", q)
      .maybeSingle();

    if (userRow) {
      const { data: spRow } = await supabase
        .from("staff_profiles")
        .select("id, user_id, full_name, username")
        .eq("user_id", (userRow as { id: string }).id)
        .maybeSingle();
      setResults(spRow ? [spRow as StaffProfileResult] : []);
      if (!spRow) setErr("User found but no staff profile exists.");
    } else {
      setResults([]);
    }
    setSearching(false);
  }

  async function invite(profile: StaffProfileResult) {
    setAdding(profile.id);
    setErr(null);
    const { data, error } = await createClient()
      .from("promoter_staff")
      .insert({ promoter_id: promoterId, user_id: profile.user_id, status: "pending" })
      .select("id, user_id, status, created_at")
      .single();
    if (error) {
      setErr(error.message);
    } else if (data) {
      const row = data as { id: string; user_id: string; status: string; created_at: string };
      onInvited({
        id: row.id, user_id: row.user_id, status: row.status, created_at: row.created_at,
        full_name: profile.full_name, email: null, username: profile.username, avg_stars: null,
      });
      setResults((r) => r.filter((x) => x.id !== profile.id));
    }
    setAdding(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950 p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Invite Staff Member</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search by username or email…"
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors" />
          <button onClick={search} disabled={searching}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50">
            {searching ? "…" : "Search"}
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        {results.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {results.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-white">{r.full_name}</p>
                  {r.username && <p className="text-xs text-zinc-500">@{r.username}</p>}
                </div>
                <button onClick={() => invite(r)} disabled={adding === r.id}
                  className="rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 px-3 py-1 text-xs font-semibold hover:bg-violet-600/40 transition-colors disabled:opacity-50">
                  {adding === r.id ? "…" : "Invite"}
                </button>
              </div>
            ))}
          </div>
        )}
        {results.length === 0 && query && !searching && (
          <p className="text-xs text-zinc-500 text-center py-2">No staff profiles found</p>
        )}
      </div>
    </div>
  );
}

// ── Staff detail modal ─────────────────────────────────────────────────────

const RATE_TYPES = [
  { key: "weekday", label: "Weekday Rate", defKey: "base_rate" as keyof DefaultPayRate },
  { key: "weekend", label: "Weekend Rate", defKey: "saturday_rate" as keyof DefaultPayRate },
  { key: "public_holiday", label: "Public Holiday Rate", defKey: "public_holiday_rate" as keyof DefaultPayRate },
];

function StaffDetailModal({ staff, promoterId, onClose }: {
  staff: PromoterStaff;
  promoterId: string;
  onClose: () => void;
}) {
  const [shiftCount, setShiftCount] = useState<number | null>(null);
  const [payRates, setPayRates] = useState<PayRateRow[]>([]);
  const [defaults, setDefaults] = useState<DefaultPayRate | null>(null);
  const [awardCode, setAwardCode] = useState<string | null>(null);
  const [staffAge, setStaffAge] = useState<number | null>(null);
  const [showPenaltyRates, setShowPenaltyRates] = useState(false);
  const [editing, setEditing] = useState<{ type: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [shiftRes, ratesRes, defRes, dobRes, profRes] = await Promise.all([
        supabase.from("shifts").select("id", { count: "exact", head: true }).eq("staff_id", staff.user_id),
        supabase.from("staff_pay_rates").select("rate_type, hourly_rate").eq("employer_id", promoterId).eq("staff_id", staff.user_id),
        supabase.from("pay_rates").select("base_rate, saturday_rate, public_holiday_rate, award_code").eq("vendor_id", promoterId).maybeSingle(),
        supabase.from("staff_profiles").select("date_of_birth").eq("user_id", staff.user_id).maybeSingle(),
        supabase.from("promoter_profiles").select("show_penalty_rates").eq("user_id", promoterId).maybeSingle(),
      ]);
      setShiftCount(shiftRes.count ?? 0);
      setPayRates((ratesRes.data as PayRateRow[]) ?? []);
      setDefaults((defRes.data as DefaultPayRate | null) ?? null);
      setAwardCode((defRes.data as { award_code: string | null } | null)?.award_code ?? null);
      setStaffAge(calculateAge((dobRes.data as { date_of_birth: string | null } | null)?.date_of_birth));
      setShowPenaltyRates((profRes.data as { show_penalty_rates: boolean } | null)?.show_penalty_rates === true);
    }
    load();
  }, [staff.user_id, promoterId]);

  const rateMap = Object.fromEntries(payRates.map((r) => [r.rate_type, r.hourly_rate]));

  async function saveRate(rateType: string, val: string) {
    const rate = parseFloat(val);
    if (isNaN(rate)) return;
    setSaving(true);
    await createClient().from("staff_pay_rates").upsert(
      { employer_id: promoterId, staff_id: staff.user_id, rate_type: rateType, hourly_rate: rate },
      { onConflict: "employer_id,staff_id,rate_type" }
    );
    setPayRates((prev) => [...prev.filter((r) => r.rate_type !== rateType), { rate_type: rateType, hourly_rate: rate }]);
    setEditing(null);
    setSaving(false);
  }

  async function clearRate(rateType: string) {
    await createClient().from("staff_pay_rates").delete().eq("employer_id", promoterId).eq("staff_id", staff.user_id).eq("rate_type", rateType);
    setPayRates((prev) => prev.filter((r) => r.rate_type !== rateType));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950 p-5 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">{staff.full_name}</h2>
            {staff.username && <p className="text-xs text-zinc-500 mt-0.5">@{staff.username}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-center">
            <p className="text-lg font-bold text-white">{staff.avg_stars != null ? staff.avg_stars.toFixed(1) : "—"}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Avg Stars</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-center">
            <p className="text-lg font-bold text-white">{shiftCount ?? "…"}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Shifts</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-center">
            <p className="text-lg font-bold text-white">—</p>
            <p className="text-xs text-zinc-500 mt-0.5">No Shows</p>
          </div>
        </div>

        {staff.email && (
          <a href={`mailto:${staff.email}`} className="flex items-center gap-2 text-xs text-indigo-400 hover:underline">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            {staff.email}
          </a>
        )}

        <div>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Pay Rate Overrides</p>
          <div className="flex flex-col gap-2">
            {RATE_TYPES.map(({ key, label, defKey }) => {
              const override = rateMap[key];
              const def = defaults?.[defKey] as number | null | undefined;
              const isEditing = editing?.type === key;
              return (
                <div key={key} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium text-zinc-300">{label}</p>
                    {def != null && <p className="text-xs text-zinc-600">Default: ${def}/hr</p>}
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.01" value={editing.value}
                        onChange={(e) => setEditing({ type: key, value: e.target.value })}
                        className="w-20 rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-white outline-none focus:border-violet-500" autoFocus />
                      <button onClick={() => saveRate(key, editing.value)} disabled={saving} className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Save</button>
                      <button onClick={() => setEditing(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {override != null ? (
                        <>
                          <span className="text-sm font-semibold text-white">${override}/hr</span>
                          <button onClick={() => setEditing({ type: key, value: String(override) })} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button onClick={() => clearRate(key)} className="text-zinc-600 hover:text-rose-400 transition-colors">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-zinc-600">Default</span>
                          <button onClick={() => setEditing({ type: key, value: String(def ?? "") })} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">Override</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Age-based FWC guideline for this staff member */}
          <div className="mt-4">
            <AwardRateGuide
              awardCode={awardCode}
              staffAge={staffAge}
              staffName={staff.full_name}
              enteredRate={rateMap["weekday"] ?? defaults?.base_rate ?? null}
              showPenaltyRates={showPenaltyRates}
              accent="violet"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StaffPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [staff, setStaff] = useState<PromoterStaff[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [selected, setSelected] = useState<PromoterStaff | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const { data: psData } = await supabase
        .from("promoter_staff")
        .select("id, user_id, status, created_at")
        .eq("promoter_id", user!.id)
        .order("created_at", { ascending: false });

      const rows = (psData as { id: string; user_id: string; status: string; created_at: string }[]) ?? [];
      const userIds = rows.map((r) => r.user_id).filter(Boolean);

      if (userIds.length === 0) { setStaff([]); setDataLoading(false); return; }

      const [usersRes, spRes, ratingsRes] = await Promise.all([
        supabase.from("users").select("id, full_name, email").in("id", userIds),
        supabase.from("staff_profiles").select("user_id, full_name, username").in("user_id", userIds),
        supabase.from("user_ratings_summary").select("user_id, average_stars").in("user_id", userIds),
      ]);

      const usersMap = Object.fromEntries(((usersRes.data ?? []) as { id: string; full_name: string; email: string }[]).map((u) => [u.id, u]));
      const spMap = Object.fromEntries(((spRes.data ?? []) as { user_id: string; full_name: string; username: string | null }[]).map((p) => [p.user_id, p]));
      const ratingMap = Object.fromEntries(((ratingsRes.data ?? []) as { user_id: string; average_stars: number }[]).map((r) => [r.user_id, r.average_stars]));

      setStaff(rows.map((r) => ({
        id: r.id, user_id: r.user_id, status: r.status, created_at: r.created_at,
        full_name: spMap[r.user_id]?.full_name ?? usersMap[r.user_id]?.full_name ?? r.user_id,
        email: usersMap[r.user_id]?.email ?? null,
        username: spMap[r.user_id]?.username ?? null,
        avg_stars: ratingMap[r.user_id] ?? null,
      })));
      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  async function deleteStaff(id: string) {
    await createClient().from("promoter_staff").delete().eq("id", id);
    setStaff((prev) => prev.filter((s) => s.id !== id));
  }

  if (authLoading || dataLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  return (
    <>
      {showInvite && user && (
        <InviteModal promoterId={user.id} onInvited={(s) => setStaff((p) => [...p, s])} onClose={() => setShowInvite(false)} />
      )}
      {selected && user && (
        <StaffDetailModal staff={selected} promoterId={user.id} onClose={() => setSelected(null)} />
      )}

      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/team" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <h1 className="text-xl font-bold flex-1">My Staff</h1>
          <button onClick={() => setShowInvite(true)} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors">
            Invite Staff Member
          </button>
        </div>

        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
          {staff.length} Staff Member{staff.length !== 1 ? "s" : ""}
        </p>

        {staff.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
            <p className="text-zinc-400 font-medium mb-1">No staff yet</p>
            <p className="text-zinc-600 text-sm">Invite staff members to your roster</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {staff.map((s) => (
              <div key={s.id}
                className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] pl-0 pr-4 py-4 overflow-hidden cursor-pointer hover:bg-white/[0.03] transition-colors"
                style={{ borderLeft: "3px solid rgb(124 58 237 / 0.6)" }}
                onClick={() => setSelected(s)}
              >
                <div className="w-10 h-10 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-sm font-bold shrink-0 ml-4">
                  {s.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm">{s.full_name}</p>
                  {s.username && <p className="text-xs text-zinc-500">@{s.username}</p>}
                  <Stars rating={s.avg_stars} />
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${
                  s.status === "accepted" ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                  : s.status === "pending" ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
                  : "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20"
                }`}>
                  {s.status.toUpperCase()}
                </span>
                <button onClick={(e) => { e.stopPropagation(); deleteStaff(s.id); }} className="text-zinc-600 hover:text-rose-400 transition-colors shrink-0">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

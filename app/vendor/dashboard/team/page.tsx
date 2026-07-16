"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";
import AwardRateGuide from "@/components/AwardRateGuide";
import { awardCodeForName, calculateAge } from "@/lib/getAwardRates";

/* ────────────────────────────────────────────────────────────────────────────
 * NOTE: Several tables/columns used here are unverified against the DB (they are
 * not referenced anywhere else in the web codebase): team_invites,
 * vendor_team_requests, vendor_staff_pins, staff_vendor_assignments.status /
 * .is_manager. Reads are defensive; writes use the documented column names.
 * ──────────────────────────────────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Tab = "staff" | "schedule" | "timesheets" | "invoices" | "payroll";

// ── Shared helpers ─────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#8b5cf6", "#3498db", "#7c3aed", "#E91E8C", "#1abc9c", "#FF6B35"];
function hashColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : name.charAt(0) || "?").toUpperCase();
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s.includes("T") ? s : s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(t: string | null) {
  if (!t) return "—";
  if (t.includes("T")) return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr % 12 === 0 ? 12 : hr % 12}:${m ?? "00"} ${hr >= 12 ? "PM" : "AM"}`;
}
function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hoursBetween(a: string | null, b: string | null) {
  if (!a || !b) return 0;
  const toMs = (t: string) => (t.includes("T") ? new Date(t).getTime() : new Date(`1970-01-01T${t}`).getTime());
  let diff = (toMs(b) - toMs(a)) / 3_600_000;
  if (diff < 0) diff += 24;
  return diff;
}

function Avatar({ name, colorKey, size = 40 }: { name: string; colorKey: string; size?: number }) {
  return (
    <div className="rounded-full flex items-center justify-center font-bold text-white shrink-0" style={{ width: size, height: size, backgroundColor: hashColor(colorKey), fontSize: size / 2.6 }}>
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
function Skeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />)}
    </div>
  );
}

// ── Award / classification / money helpers ─────────────────────────────────
// NOTE: classification/award/employment_type on staff_vendor_assignments,
// abn/abn_verified/abn_business_name on staff_profiles, staff_availability, and
// contractor_invoices are all unverified against the DB — reads are defensive.

const AWARD_OPTIONS = ["Hospitality", "Restaurant", "Fast Food", "Retail", "Events"];
const EMPLOYMENT_TYPES: [string, string][] = [["casual", "Casual"], ["part_time", "Part-time"], ["full_time", "Full-time"]];
const AWARD_MULTIPLIERS = { weekday: 1.0, saturday: 1.25, sunday: 1.75, public_holiday: 2.25, late_night: 1.15 };

// Multiplier + penalty label for a shift date/time. Public holidays aren't
// derivable without a PH calendar, so only weekend + late-night are detected.
function awardInfo(dateStr: string, startTime?: string | null): { mult: number; label: string | null } {
  const d = new Date((dateStr || "").includes("T") ? dateStr : dateStr + "T00:00:00");
  const dow = d.getDay();
  if (dow === 0) return { mult: AWARD_MULTIPLIERS.sunday, label: "Sunday 1.75×" };
  if (dow === 6) return { mult: AWARD_MULTIPLIERS.saturday, label: "Saturday 1.25×" };
  if (startTime) {
    const h = parseInt(startTime.split(":")[0], 10);
    if (!isNaN(h) && (h >= 22 || h < 6)) return { mult: AWARD_MULTIPLIERS.late_night, label: "Late night 1.15×" };
  }
  return { mult: AWARD_MULTIPLIERS.weekday, label: null };
}
function money(n: number) {
  return `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ════════════════════════════════════════════════════════════════════════════
// MY STAFF TAB
// ════════════════════════════════════════════════════════════════════════════

type Member = {
  staff_id: string;
  full_name: string;
  username: string | null;
  is_manager: boolean;
  rating: number | null;
  shift_count: number;
  pin: string | null;
  rates: { weekday: string; weekend: string; public_holiday: string };
  classification: string; // "employee" | "contractor"
  award: string | null;
  employment_type: string | null;
  abn: string | null;
  abn_verified: boolean;
  abn_business_name: string | null;
  date_of_birth: string | null;
};
type TeamRequest = { id: string; staff_id: string; full_name: string; username: string | null };

function InviteModal({ vendorId, onClose }: { vendorId: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ staff_id: string; full_name: string; username: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    const supabase = createClient();
    const q = query.trim().replace(/^@/, "");
    const [spRes, uRes] = await Promise.all([
      supabase.from("staff_profiles").select("user_id, full_name, username").or(`username.ilike.%${q}%,full_name.ilike.%${q}%`).limit(8),
      supabase.from("users").select("id, full_name, email").ilike("email", `%${q}%`).limit(8),
    ]);
    const map: Record<string, { staff_id: string; full_name: string; username: string | null }> = {};
    for (const r of (spRes.data ?? []) as any[]) map[r.user_id] = { staff_id: r.user_id, full_name: r.full_name, username: r.username };
    for (const u of (uRes.data ?? []) as any[]) if (!map[u.id]) map[u.id] = { staff_id: u.id, full_name: u.full_name, username: null };
    setResults(Object.values(map));
    setSearching(false);
  }

  async function invite(staffId: string) {
    await createClient().from("team_invites").insert({ vendor_id: vendorId, staff_id: staffId });
    setInvited((prev) => new Set(prev).add(staffId));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Invite Team Members</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex gap-2 mb-4">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="@username or email"
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors" />
          <button onClick={search} disabled={searching} className="rounded-lg bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
            {searching ? "…" : "Search"}
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {results.map((r) => (
            <div key={r.staff_id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <Avatar name={r.full_name} colorKey={r.staff_id} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{r.full_name}</p>
                {r.username && <p className="text-xs text-zinc-500">@{r.username}</p>}
              </div>
              <button onClick={() => invite(r.staff_id)} disabled={invited.has(r.staff_id)}
                className="rounded-lg bg-[#FF6B35]/15 border border-[#FF6B35]/30 text-[#FF6B35] px-3 py-1 text-xs font-semibold hover:bg-[#FF6B35]/25 transition-colors disabled:opacity-50">
                {invited.has(r.staff_id) ? "Invited" : "Invite"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PinModal({ vendorId, member, onClose, onSaved }: { vendorId: string; member: Member; onClose: () => void; onSaved: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (pin.length !== 4) { setErr("Enter a 4-digit PIN."); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();
    const { data: clash } = await supabase.from("vendor_staff_pins").select("staff_id").eq("vendor_id", vendorId).eq("pin", pin).maybeSingle();
    if (clash && (clash as any).staff_id !== member.staff_id) { setErr("That PIN is already in use."); setSaving(false); return; }
    await supabase.from("vendor_staff_pins").upsert({ vendor_id: vendorId, staff_id: member.staff_id, pin }, { onConflict: "vendor_id,staff_id" });
    onSaved(pin);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-xs rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <h3 className="font-semibold text-white mb-1">Set PIN</h3>
        <p className="text-xs text-zinc-500 mb-5">{member.full_name}</p>
        <div className="flex justify-center gap-3 mb-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? "bg-[#FF6B35]" : "bg-white/[0.1]"}`} />
          ))}
        </div>
        <input
          autoFocus inputMode="numeric" maxLength={4} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="w-full text-center tracking-[0.5em] rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-lg text-white outline-none focus:border-[#FF6B35] transition-colors"
          placeholder="••••"
        />
        {err && <p className="text-xs text-red-400 mt-3">{err}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 h-9 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function MyStaffTab({ vendorId }: { vendorId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [pinFor, setPinFor] = useState<Member | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState<string | null>(null);
  const [payEditFor, setPayEditFor] = useState<string | null>(null);
  const [vendorAwardCode, setVendorAwardCode] = useState<string | null>(null);
  const [showPenaltyRates, setShowPenaltyRates] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Vendor-level FWC preferences: default award + penalty-breakdown toggle.
    const [vendorRateRes, vendorProfRes] = await Promise.all([
      supabase.from("pay_rates").select("award_code").eq("vendor_id", vendorId).maybeSingle(),
      supabase.from("vendor_profiles").select("show_penalty_rates").eq("user_id", vendorId).maybeSingle(),
    ]);
    setVendorAwardCode((vendorRateRes.data as any)?.award_code ?? null);
    setShowPenaltyRates((vendorProfRes.data as any)?.show_penalty_rates === true);

    const { data: svaRows } = await supabase.from("staff_vendor_assignments").select("*").eq("vendor_id", vendorId);
    const rows = (svaRows ?? []) as any[];
    const staffIds = [...new Set(rows.map((r) => r.staff_id).filter(Boolean))];

    const [uRes, spRes, ratingRes, pinRes, shiftRes, payRes, reqRes, mgrRes] = await Promise.all([
      staffIds.length ? supabase.from("users").select("id, full_name").in("id", staffIds) : Promise.resolve({ data: [] as any[] }),
      staffIds.length ? supabase.from("staff_profiles").select("user_id, username, abn, abn_verified, abn_business_name, date_of_birth").in("user_id", staffIds) : Promise.resolve({ data: [] as any[] }),
      staffIds.length ? supabase.from("user_ratings_summary").select("user_id, average_stars").in("user_id", staffIds) : Promise.resolve({ data: [] as any[] }),
      supabase.from("vendor_staff_pins").select("staff_id, pin").eq("vendor_id", vendorId),
      supabase.from("shifts").select("staff_id").eq("vendor_id", vendorId).eq("status", "completed"),
      supabase.from("staff_pay_rates").select("staff_id, rate_type, hourly_rate").eq("employer_id", vendorId),
      supabase.from("vendor_team_requests").select("*").eq("vendor_id", vendorId).eq("status", "pending"),
      supabase.from("manager_assignments").select("staff_id").eq("vendor_id", vendorId),
    ]);

    const managerSet = new Set(((mgrRes.data ?? []) as any[]).map((r) => r.staff_id));

    const nameMap = Object.fromEntries(((uRes.data ?? []) as any[]).map((u) => [u.id, u.full_name]));
    const spByUser = Object.fromEntries(((spRes.data ?? []) as any[]).map((p) => [p.user_id, p]));
    const userMap = Object.fromEntries(((spRes.data ?? []) as any[]).map((p) => [p.user_id, p.username]));
    const svaByStaff = Object.fromEntries(rows.map((r) => [r.staff_id, r]));
    const ratingMap = Object.fromEntries(((ratingRes.data ?? []) as any[]).map((r) => [r.user_id, r.average_stars]));
    const pinMap = Object.fromEntries(((pinRes.data ?? []) as any[]).map((p) => [p.staff_id, p.pin]));
    const shiftCount: Record<string, number> = {};
    for (const s of (shiftRes.data ?? []) as any[]) shiftCount[s.staff_id] = (shiftCount[s.staff_id] ?? 0) + 1;
    const rateMap: Record<string, Record<string, number>> = {};
    for (const r of (payRes.data ?? []) as any[]) (rateMap[r.staff_id] ??= {})[r.rate_type] = r.hourly_rate;

    setMembers(rows.map((r) => ({
      staff_id: r.staff_id,
      full_name: nameMap[r.staff_id] ?? "Unknown",
      username: userMap[r.staff_id] ?? null,
      is_manager: managerSet.has(r.staff_id),
      rating: ratingMap[r.staff_id] ?? null,
      shift_count: shiftCount[r.staff_id] ?? 0,
      pin: pinMap[r.staff_id] ?? null,
      rates: {
        weekday: rateMap[r.staff_id]?.weekday != null ? String(rateMap[r.staff_id].weekday) : "",
        weekend: rateMap[r.staff_id]?.weekend != null ? String(rateMap[r.staff_id].weekend) : "",
        public_holiday: rateMap[r.staff_id]?.public_holiday != null ? String(rateMap[r.staff_id].public_holiday) : "",
      },
      classification: (svaByStaff[r.staff_id]?.classification ?? "employee") as string,
      award: svaByStaff[r.staff_id]?.award ?? null,
      employment_type: svaByStaff[r.staff_id]?.employment_type ?? null,
      abn: spByUser[r.staff_id]?.abn ?? null,
      abn_verified: spByUser[r.staff_id]?.abn_verified === true,
      abn_business_name: spByUser[r.staff_id]?.abn_business_name ?? null,
      date_of_birth: spByUser[r.staff_id]?.date_of_birth ?? null,
    })));

    // Pending requests + names
    const reqRows = (reqRes.data ?? []) as any[];
    const reqIds = [...new Set(reqRows.map((r) => r.staff_id))];
    let reqNames: Record<string, string> = {}, reqUsernames: Record<string, string> = {};
    if (reqIds.length) {
      const [ru, rsp] = await Promise.all([
        supabase.from("users").select("id, full_name").in("id", reqIds),
        supabase.from("staff_profiles").select("user_id, username").in("user_id", reqIds),
      ]);
      reqNames = Object.fromEntries(((ru.data ?? []) as any[]).map((u) => [u.id, u.full_name]));
      reqUsernames = Object.fromEntries(((rsp.data ?? []) as any[]).map((p) => [p.user_id, p.username]));
    }
    setRequests(reqRows.map((r) => ({ id: r.id, staff_id: r.staff_id, full_name: reqNames[r.staff_id] ?? "Unknown", username: reqUsernames[r.staff_id] ?? null })));

    setLoading(false);
  }, [vendorId]);

  useEffect(() => { load(); }, [load]);

  async function respondRequest(req: TeamRequest, status: "approved" | "declined") {
    setReqBusy(req.id);
    const supabase = createClient();
    await supabase.from("vendor_team_requests").update({ status }).eq("id", req.id);
    if (status === "approved") {
      await supabase.from("staff_vendor_assignments").upsert({ vendor_id: vendorId, staff_id: req.staff_id, status: "active" }, { onConflict: "vendor_id,staff_id" });
    }
    await load();
    setReqBusy(null);
  }

  async function toggleManager(m: Member) {
    const supabase = createClient();
    const next = !m.is_manager;
    if (next) {
      await supabase.from("manager_assignments").insert({ vendor_id: vendorId, staff_id: m.staff_id, assigned_by: vendorId });
    } else {
      await supabase.from("manager_assignments").delete().eq("vendor_id", vendorId).eq("staff_id", m.staff_id);
    }
    await supabase.from("staff_profiles").update({ is_manager: next }).eq("user_id", m.staff_id);
    setMembers((prev) => prev.map((x) => (x.staff_id === m.staff_id ? { ...x, is_manager: next } : x)));
  }

  async function removeMember(staffId: string) {
    await createClient().from("staff_vendor_assignments").delete().eq("vendor_id", vendorId).eq("staff_id", staffId);
    setMembers((prev) => prev.filter((x) => x.staff_id !== staffId));
    setConfirmRemove(null);
  }

  async function savePayOverride(m: Member, rates: Member["rates"]) {
    const supabase = createClient();
    const entries: { rate_type: string; value: string }[] = [
      { rate_type: "weekday", value: rates.weekday },
      { rate_type: "weekend", value: rates.weekend },
      { rate_type: "public_holiday", value: rates.public_holiday },
    ];
    for (const e of entries) {
      if (e.value.trim() === "") continue;
      await supabase.from("staff_pay_rates").upsert(
        { employer_id: vendorId, staff_id: m.staff_id, rate_type: e.rate_type, hourly_rate: parseFloat(e.value) },
        { onConflict: "employer_id,staff_id,rate_type" }
      );
    }
    setMembers((prev) => prev.map((x) => (x.staff_id === m.staff_id ? { ...x, rates } : x)));
    setPayEditFor(null);
  }

  async function saveAssignment(staffId: string, patch: Partial<Member>) {
    const dbPatch: Record<string, any> = {};
    if ("classification" in patch) dbPatch.classification = patch.classification;
    if ("award" in patch) dbPatch.award = patch.award;
    if ("employment_type" in patch) dbPatch.employment_type = patch.employment_type;
    setMembers((prev) => prev.map((x) => (x.staff_id === staffId ? { ...x, ...patch } : x)));
    await createClient().from("staff_vendor_assignments").update(dbPatch).eq("vendor_id", vendorId).eq("staff_id", staffId);
  }

  if (loading) return <Skeleton count={4} />;

  return (
    <div className="flex flex-col gap-6">
      <button onClick={() => setShowInvite(true)} className="self-start flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Invite Team Members
      </button>

      {requests.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-4">
          <p className="text-sm font-semibold text-amber-400 mb-3">Pending Requests ({requests.length})</p>
          <div className="flex flex-col gap-2">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-[#1a1a1a] px-3 py-2.5">
                <Avatar name={r.full_name} colorKey={r.staff_id} size={34} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{r.full_name}</p>
                  {r.username && <p className="text-xs text-zinc-500">@{r.username}</p>}
                </div>
                <button onClick={() => respondRequest(r, "approved")} disabled={reqBusy === r.id} className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 flex items-center justify-center hover:bg-emerald-600/40 transition-colors disabled:opacity-50" aria-label="Approve">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <button onClick={() => respondRequest(r, "declined")} disabled={reqBusy === r.id} className="w-8 h-8 rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 flex items-center justify-center hover:bg-rose-600/40 transition-colors disabled:opacity-50" aria-label="Decline">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>} title="No team members yet" sub="Invite staff to build your team." />
      ) : (
        <div className="flex flex-col gap-3">
          {members.map((m) => (
            <div key={m.staff_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <div className="flex items-center gap-4">
                <Avatar name={m.full_name} colorKey={m.staff_id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white truncate">{m.full_name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.classification === "contractor" ? "bg-purple-500/15 text-purple-300" : "bg-blue-500/15 text-blue-300"}`}>
                      {m.classification === "contractor" ? "Contractor" : "Employee"}
                    </span>
                    {m.is_manager && <span className="rounded-full bg-[#FF6B35]/15 px-2 py-0.5 text-[10px] font-semibold text-[#FF6B35]">MANAGER</span>}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {m.username ? `@${m.username}` : ""}
                    {m.rating != null ? `${m.username ? " · " : ""}★ ${Number(m.rating).toFixed(1)}` : ""}
                    {` · ${m.shift_count} shift${m.shift_count !== 1 ? "s" : ""}`}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.pin ? "bg-amber-500/10 text-amber-400" : "bg-zinc-500/10 text-zinc-400"}`}>
                  {m.pin ? "PIN Set" : "No PIN"}
                </span>
              </div>

              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <button onClick={() => setPinFor(m)} className="text-xs font-medium text-[#FF6B35] hover:underline">Set PIN</button>
                <button onClick={() => toggleManager(m)} className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">
                  {m.is_manager ? "Remove Manager" : "Make Manager"}
                </button>
                <button onClick={() => setPayEditFor(payEditFor === m.staff_id ? null : m.staff_id)} className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">
                  Pay Rates
                </button>
                <div className="flex-1" />
                {confirmRemove === m.staff_id ? (
                  <div className="flex items-center gap-2">
                    <button onClick={() => removeMember(m.staff_id)} className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors">Confirm</button>
                    <button onClick={() => setConfirmRemove(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmRemove(m.staff_id)} className="text-zinc-600 hover:text-rose-400 transition-colors" aria-label="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                )}
              </div>

              {/* Classification controls */}
              <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Classification</label>
                  <select
                    value={m.classification}
                    onChange={(e) => saveAssignment(m.staff_id, { classification: e.target.value })}
                    className="rounded-md border border-white/[0.08] bg-[#141414] px-2 py-1 text-xs text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]"
                  >
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </div>

                {m.classification === "contractor" ? (
                  <div className="text-xs text-zinc-400">
                    ABN: <span className="text-zinc-200 font-medium">{m.abn ?? "Not provided"}</span>
                    {m.abn_verified && <span className="text-emerald-400 ml-1">✅</span>}
                    {m.abn_business_name && <span className="text-zinc-500"> · {m.abn_business_name}</span>}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Award</label>
                      <select
                        value={m.award ?? ""}
                        onChange={(e) => saveAssignment(m.staff_id, { award: e.target.value || null })}
                        className="rounded-md border border-white/[0.08] bg-[#141414] px-2 py-1 text-xs text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]"
                      >
                        <option value="">Select…</option>
                        {AWARD_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {EMPLOYMENT_TYPES.map(([val, lbl]) => (
                        <button key={val} onClick={() => saveAssignment(m.staff_id, { employment_type: val })}
                          className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${m.employment_type === val ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"}`}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {payEditFor === m.staff_id && (
                <PayOverrideEditor
                  member={m}
                  awardCode={awardCodeForName(m.award) ?? vendorAwardCode}
                  showPenaltyRates={showPenaltyRates}
                  onSave={(rates) => savePayOverride(m, rates)}
                  onCancel={() => setPayEditFor(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {showInvite && <InviteModal vendorId={vendorId} onClose={() => setShowInvite(false)} />}
      {pinFor && <PinModal vendorId={vendorId} member={pinFor} onClose={() => setPinFor(null)} onSaved={(pin) => setMembers((prev) => prev.map((x) => (x.staff_id === pinFor.staff_id ? { ...x, pin } : x)))} />}
    </div>
  );
}

function PayOverrideEditor({ member, awardCode, showPenaltyRates, onSave, onCancel }: {
  member: Member;
  awardCode: string | null;
  showPenaltyRates: boolean;
  onSave: (rates: Member["rates"]) => void;
  onCancel: () => void;
}) {
  const [rates, setRates] = useState(member.rates);
  const fields: [keyof Member["rates"], string][] = [["weekday", "Weekday"], ["weekend", "Sat + Sun"], ["public_holiday", "Public Holiday"]];
  const staffAge = calculateAge(member.date_of_birth);
  return (
    <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Pay Rate Override ($/hr)</p>
      <div className="grid grid-cols-3 gap-2">
        {fields.map(([key, label]) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-500">{label}</label>
            <input type="number" min="0" step="0.01" value={rates[key]} onChange={(e) => setRates((p) => ({ ...p, [key]: e.target.value }))}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white outline-none focus:border-[#FF6B35] transition-colors [appearance:textfield]" />
          </div>
        ))}
      </div>
      {/* Age-based FWC guideline for this staff member */}
      <div className="mt-3">
        <AwardRateGuide
          awardCode={awardCode}
          staffAge={staffAge}
          staffName={member.full_name}
          enteredRate={rates.weekday.trim() === "" ? null : parseFloat(rates.weekday)}
          showPenaltyRates={showPenaltyRates}
          accent="orange"
        />
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => onSave(rates)} className="rounded-md bg-[#FF6B35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#ff7d4d] transition-colors">Save</button>
        <button onClick={onCancel} className="rounded-md border border-white/[0.08] px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SCHEDULE TAB
// ════════════════════════════════════════════════════════════════════════════

type Schedule = {
  id: string;
  staff_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  role: string | null;
  notes: string | null;
  status: string;
  location: string | null;
  pay_rate: number | null;
  is_open: boolean;
  max_staff: number;
  visibility: string;
  requirements: string | null;
  event_id: string | null;
  truck_id: string | null;
  staff?: { full_name: string } | null;
  event?: { name: string } | null;
  truck?: { name: string } | null;
};
type StaffOption = { staff_id: string; full_name: string };
type TruckOption = { id: string; name: string };
type EventOption = { id: string; name: string; start_date: string | null; end_date: string | null };
type ShiftClaim = { id: string; schedule_id: string; staff_id: string; status: string; staff?: { full_name: string } | null };

// Fetch schedules with staff / event / truck relations
const SCHEDULE_SELECT = "*, staff:users(full_name), event:events(name), truck:vendor_trucks(name)";
const VISIBILITY_OPTIONS: [string, string][] = [["team", "Team Only"], ["all", "All Crewbase Staff"]];

function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

type ShiftType = "assigned" | "open" | "event";

const inputCls = "rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors";
const dateCls = inputCls + " [color-scheme:dark]";

function ShiftModal({ vendorId, staff, trucks, events, existing, defaultDate, onClose, onSaved }: {
  vendorId: string; staff: StaffOption[]; trucks: TruckOption[]; events: EventOption[];
  existing: Schedule | null; defaultDate: string; onClose: () => void; onSaved: () => void;
}) {
  const initialType: ShiftType = existing?.is_open ? "open" : existing?.event_id ? "event" : "assigned";
  const [shiftType, setShiftType] = useState<ShiftType>(initialType);
  const [date, setDate] = useState(existing?.shift_date ?? defaultDate);
  const [start, setStart] = useState(existing?.start_time?.slice(0, 5) ?? "");
  const [end, setEnd] = useState(existing?.end_time?.slice(0, 5) ?? "");
  const [staffId, setStaffId] = useState(existing?.staff_id ?? "");
  const [role, setRole] = useState(existing?.role ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [payRate, setPayRate] = useState(existing?.pay_rate != null ? String(existing.pay_rate) : "");
  const [truckId, setTruckId] = useState(existing?.truck_id ?? "");
  const [eventId, setEventId] = useState(existing?.event_id ?? "");
  const [maxStaff, setMaxStaff] = useState(existing?.max_staff != null ? String(existing.max_staff) : "1");
  const [requirements, setRequirements] = useState(existing?.requirements ?? "");
  const [visibility, setVisibility] = useState(existing?.visibility ?? "team");
  const [availMsg, setAvailMsg] = useState<{ kind: "warn" | "hint"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Availability check for the selected staff + date (assigned / event shifts)
  useEffect(() => {
    let cancelled = false;
    if ((shiftType !== "assigned" && shiftType !== "event") || !staffId || !date) { setAvailMsg(null); return; }
    (async () => {
      const { data } = await createClient().from("staff_availability").select("type").eq("staff_id", staffId).eq("date", date).maybeSingle();
      if (cancelled) return;
      const type = (data as any)?.type;
      const name = staff.find((s) => s.staff_id === staffId)?.full_name ?? "This staff member";
      if (type === "unavailable") setAvailMsg({ kind: "warn", text: `⚠️ ${name} is unavailable on this date` });
      else if (type === "preferred") setAvailMsg({ kind: "hint", text: `✅ This is a preferred date for ${name}` });
      else setAvailMsg(null);
    })();
    return () => { cancelled = true; };
  }, [shiftType, staffId, date, staff]);

  function pickEvent(id: string) {
    setEventId(id);
    const ev = events.find((e) => e.id === id);
    if (ev?.start_date) setDate(ev.start_date.slice(0, 10));
  }

  async function submit() {
    if (!date) { setErr("Date is required."); return; }
    if (shiftType === "assigned" && !staffId) { setErr("Select a staff member."); return; }
    if (shiftType === "event" && !eventId) { setErr("Select an event."); return; }
    if (shiftType === "event" && !staffId) { setErr("Select a staff member."); return; }
    setSaving(true);
    setErr(null);

    const base = {
      vendor_id: vendorId,
      shift_date: date,
      start_time: start || null,
      end_time: end || null,
      role: role.trim() || null,
      notes: notes.trim() || null,
      location: location.trim() || null,
      pay_rate: payRate ? parseFloat(payRate) : null,
      truck_id: truckId || null,
      status: "scheduled",
    };

    const payload =
      shiftType === "open"
        ? { ...base, staff_id: null, event_id: null, is_open: true, max_staff: parseInt(maxStaff, 10) || 1, visibility, requirements: requirements.trim() || null }
        : shiftType === "event"
        ? { ...base, staff_id: staffId, event_id: eventId, is_open: false }
        : { ...base, staff_id: staffId, event_id: null, is_open: false };

    const supabase = createClient();
    const { error } = existing
      ? await supabase.from("schedules").update(payload).eq("id", existing.id)
      : await supabase.from("schedules").insert(payload);
    if (error) { setErr(error.message); setSaving(false); return; }
    onSaved();
    onClose();
  }

  const StaffPicker = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Staff</label>
      <div className="flex flex-wrap gap-2">
        {staff.map((s) => (
          <button key={s.staff_id} type="button" onClick={() => setStaffId(s.staff_id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${staffId === s.staff_id ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"}`}>
            {s.full_name}
          </button>
        ))}
        {staff.length === 0 && <span className="text-xs text-zinc-600">No staff yet.</span>}
      </div>
    </div>
  );

  const TimeFields = (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Start</label>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={dateCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">End</label>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={dateCls} />
      </div>
    </div>
  );

  const RoleField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Role</label>
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Cashier" className={inputCls} />
    </div>
  );
  const LocationField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Location</label>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue / area" className={inputCls} />
    </div>
  );
  const PayField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Pay Rate ($/hr)</label>
      <input type="number" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} placeholder="25.00" className={inputCls + " [appearance:textfield]"} />
    </div>
  );
  const TruckField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Truck</label>
      <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={inputCls + " bg-[#141414]"}>
        <option value="">No truck</option>
        {trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  );
  const NotesField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Notes</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls + " resize-none"} />
    </div>
  );
  const DateField = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Date</label>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dateCls} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">{existing ? "Edit Shift" : "Add Shift"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {/* Shift type selector */}
          <div className="flex gap-2">
            {(["assigned", "open", "event"] as ShiftType[]).map((t) => (
              <button key={t} type="button" onClick={() => setShiftType(t)}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold capitalize transition-colors ${shiftType === t ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"}`}>
                {t}
              </button>
            ))}
          </div>

          {shiftType === "assigned" && (
            <>
              {StaffPicker}
              {DateField}
              {TimeFields}
              {RoleField}
              {LocationField}
              {PayField}
              {TruckField}
              {NotesField}
            </>
          )}

          {shiftType === "open" && (
            <>
              {DateField}
              {TimeFields}
              {RoleField}
              {LocationField}
              {PayField}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Max Staff</label>
                <input type="number" min="1" step="1" value={maxStaff} onChange={(e) => setMaxStaff(e.target.value)} className={inputCls + " [appearance:textfield]"} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Requirements</label>
                <input value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="e.g. RSA required" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Visibility</label>
                <div className="flex flex-col gap-1.5">
                  {VISIBILITY_OPTIONS.map(([val, lbl]) => (
                    <label key={val} className="flex items-center gap-2.5 cursor-pointer">
                      <input type="radio" name="visibility" checked={visibility === val} onChange={() => setVisibility(val)} className="w-4 h-4 text-[#FF6B35] focus:ring-[#FF6B35]" />
                      <span className="text-sm text-zinc-300">{lbl}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {shiftType === "event" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Event</label>
                <select value={eventId} onChange={(e) => pickEvent(e.target.value)} className={inputCls + " bg-[#141414]"}>
                  <option value="">Select an event…</option>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
              {StaffPicker}
              {DateField}
              {TimeFields}
              {TruckField}
              {RoleField}
              {PayField}
              {NotesField}
            </>
          )}

          {availMsg && (
            <p className={`text-xs rounded-lg px-3 py-2 ${availMsg.kind === "warn" ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"}`}>{availMsg.text}</p>
          )}
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleTab({ vendorId }: { vendorId: string }) {
  const [scheduleView, setScheduleView] = useState<"Week" | "Month" | "Open Shifts">("Week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  const [schedules, setSchedules] = useState<Schedule[]>([]); // week OR month range
  const [availByDate, setAvailByDate] = useState<Record<string, { unavailable: boolean; preferred: boolean }>>({});
  const [openShifts, setOpenShifts] = useState<Schedule[]>([]);
  const [claimsBySchedule, setClaimsBySchedule] = useState<Record<string, ShiftClaim[]>>({});
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ existing: Schedule | null; date: string } | null>(null);

  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);

  // ── Reference data (staff / trucks / events) — loaded once ──
  const loadRefs = useCallback(async () => {
    const supabase = createClient();
    const [svaRes, truckRes, evRes, ownedRes] = await Promise.all([
      supabase.from("staff_vendor_assignments").select("staff_id").eq("vendor_id", vendorId),
      supabase.from("vendor_trucks").select("id, name").eq("vendor_id", vendorId).order("name", { ascending: true }),
      supabase.from("event_vendors").select("event_id").eq("vendor_id", vendorId),
      supabase.from("events").select("id, name, start_date, end_date").eq("vendor_id", vendorId),
    ]);
    const svaIds = [...new Set(((svaRes.data ?? []) as any[]).map((r) => r.staff_id))];
    let nameMap: Record<string, string> = {};
    if (svaIds.length) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", svaIds);
      nameMap = Object.fromEntries(((users ?? []) as any[]).map((u) => [u.id, u.full_name]));
    }
    setStaff(svaIds.map((id) => ({ staff_id: id, full_name: nameMap[id] ?? "Unknown" })));
    setTrucks((truckRes.data ?? []) as TruckOption[]);

    const eventsById: Record<string, EventOption> = {};
    for (const e of (ownedRes.data ?? []) as any[]) eventsById[e.id] = e;
    const linkedIds = ((evRes.data ?? []) as any[]).map((r) => r.event_id);
    if (linkedIds.length) {
      const { data: inv } = await supabase.from("events").select("id, name, start_date, end_date").in("id", linkedIds);
      for (const e of (inv ?? []) as any[]) eventsById[e.id] = e;
    }
    const today = toISODate(new Date());
    setEvents(Object.values(eventsById)
      .filter((e) => !e.end_date || e.end_date >= today)
      .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? "")));
  }, [vendorId]);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  // ── Schedules — depends on active view ──
  const loadSchedules = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    if (scheduleView === "Open Shifts") {
      const { data } = await supabase.from("schedules").select(SCHEDULE_SELECT)
        .eq("vendor_id", vendorId).eq("is_open", true).neq("status", "cancelled")
        .order("shift_date", { ascending: true });
      const open = ((data ?? []) as any[]) as Schedule[];
      setOpenShifts(open);
      const ids = open.map((o) => o.id);
      const claims: Record<string, ShiftClaim[]> = {};
      if (ids.length) {
        const { data: cl } = await supabase.from("shift_claims").select("*, staff:users(full_name)").in("schedule_id", ids);
        for (const c of (cl ?? []) as any[]) (claims[c.schedule_id] ??= []).push(c);
      }
      setClaimsBySchedule(claims);
    } else {
      let start: Date, end: Date;
      if (scheduleView === "Month") {
        start = mondayOf(monthAnchor);
        end = new Date(start); end.setDate(end.getDate() + 41); // 6-week grid
      } else {
        start = weekStart; end = new Date(weekStart); end.setDate(end.getDate() + 6);
      }
      const { data } = await supabase.from("schedules").select(SCHEDULE_SELECT)
        .eq("vendor_id", vendorId).gte("shift_date", toISODate(start)).lte("shift_date", toISODate(end));
      setSchedules(((data ?? []) as any[]).filter((r) => r.status !== "cancelled") as Schedule[]);

      // Availability markers (Week view only)
      if (scheduleView === "Week") {
        const { data: svaIds2 } = await supabase.from("staff_vendor_assignments").select("staff_id").eq("vendor_id", vendorId);
        const teamIds = [...new Set(((svaIds2 ?? []) as any[]).map((r) => r.staff_id))];
        const avail: Record<string, { unavailable: boolean; preferred: boolean }> = {};
        if (teamIds.length) {
          const { data: av } = await supabase.from("staff_availability").select("staff_id, date, type")
            .in("staff_id", teamIds).gte("date", toISODate(start)).lte("date", toISODate(end));
          for (const a of (av ?? []) as any[]) {
            const key = (a.date || "").slice(0, 10);
            if (!avail[key]) avail[key] = { unavailable: false, preferred: false };
            if (a.type === "unavailable") avail[key].unavailable = true;
            if (a.type === "preferred") avail[key].preferred = true;
          }
        }
        setAvailByDate(avail);
      }
    }
    setLoading(false);
  }, [vendorId, scheduleView, weekStart, monthAnchor]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  async function cancelShift(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Cancel this shift?")) return;
    await createClient().from("schedules").update({ status: "cancelled" }).eq("id", id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

  async function copyLastWeek() {
    const supabase = createClient();
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(lastWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

    const { data: lastWeekShifts } = await supabase
      .from("schedules")
      .select("*")
      .eq("vendor_id", vendorId)
      .in("status", ["scheduled", "confirmed"])
      .gte("shift_date", lastWeekStart.toISOString().split("T")[0])
      .lte("shift_date", lastWeekEnd.toISOString().split("T")[0]);

    if (!lastWeekShifts?.length) return;

    const newShifts = (lastWeekShifts as any[]).map((s) => ({
      vendor_id: s.vendor_id,
      staff_id: s.staff_id,
      shift_date: new Date(new Date(s.shift_date).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      start_time: s.start_time,
      end_time: s.end_time,
      role: s.role,
      notes: s.notes,
      location: s.location,
      pay_rate: s.pay_rate,
      truck_id: s.truck_id,
      event_id: s.event_id,
      is_open: s.is_open,
      max_staff: s.max_staff,
      visibility: s.visibility,
      status: "scheduled",
    }));

    await supabase.from("schedules").insert(newShifts);
    loadSchedules();
  }

  async function approveClaim(shift: Schedule, claim: ShiftClaim) {
    const supabase = createClient();
    await supabase.from("schedules").update({ staff_id: claim.staff_id, is_open: false }).eq("id", shift.id);
    await supabase.from("shift_claims").update({ status: "approved" }).eq("id", claim.id);
    loadSchedules();
  }
  async function rejectClaim(claim: ShiftClaim) {
    await createClient().from("shift_claims").update({ status: "rejected" }).eq("id", claim.id);
    loadSchedules();
  }

  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i);
    return d;
  });
  const label = `${weekStart.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })} – ${weekEnd.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}`;

  const shiftLine = (s: Schedule) => {
    const award = awardInfo(s.shift_date, s.start_time);
    const hrs = hoursBetween(s.start_time, s.end_time);
    const est = s.pay_rate != null ? hrs * s.pay_rate * award.mult : null;
    return (
    <div key={s.id} className="rounded-lg bg-white/[0.02] border border-white/[0.06] border-l-2 border-l-[#FF6B35] px-3 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">
          {s.is_open ? "Open shift" : s.staff?.full_name ?? "Unassigned"}
          {s.event?.name && <span className="text-zinc-500 font-normal"> · {s.event.name}</span>}
        </p>
        <p className="text-xs text-zinc-500">
          {fmtTime(s.start_time)} – {fmtTime(s.end_time)}{s.role ? ` · ${s.role}` : ""}{s.truck?.name ? ` · ${s.truck.name}` : ""}
        </p>
        {(est != null || award.label) && (
          <p className="text-xs mt-0.5">
            {est != null && <span className="text-[#FF6B35] font-medium">~{money(est)}</span>}
            {award.label && <span className="text-amber-400 ml-1.5">{award.label}</span>}
          </p>
        )}
      </div>
      <button onClick={() => setModal({ existing: s, date: s.shift_date })} className="text-xs text-zinc-500 hover:text-white transition-colors">Edit</button>
      <button onClick={() => cancelShift(s.id)} className="text-zinc-600 hover:text-rose-400 transition-colors" aria-label="Cancel shift">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    );
  };

  // Month grid (6 weeks starting Monday of the month)
  const gridStart = mondayOf(monthAnchor);
  const monthCells = Array.from({ length: 42 }).map((_, i) => {
    const d = new Date(gridStart); d.setDate(d.getDate() + i);
    return d;
  });
  const countByDate: Record<string, number> = {};
  for (const s of schedules) countByDate[s.shift_date] = (countByDate[s.shift_date] ?? 0) + 1;

  return (
    <div className="flex flex-col gap-5">
      {/* View tabs */}
      <div className="flex gap-2 mb-1 overflow-x-auto scrollbar-none">
        {(["Week", "Month", "Open Shifts"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setScheduleView(tab)}
            className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              scheduleView === tab ? "bg-[#FF6B35] text-white" : "bg-[#1a1a1a] text-zinc-400 hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── WEEK VIEW ── */}
      {scheduleView === "Week" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setWeekStart((w) => { const n = new Date(w); n.setDate(n.getDate() - 7); return n; })} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">{label}</p>
              <button onClick={copyLastWeek} className="rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-2.5 py-1 text-[10px] font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors">
                Copy Last Week
              </button>
            </div>
            <button onClick={() => setWeekStart((w) => { const n = new Date(w); n.setDate(n.getDate() + 7); return n; })} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          {loading ? <Skeleton count={5} /> : (
            <div className="flex flex-col gap-4">
              {days.map((d) => {
                const iso = toISODate(d);
                const dayShifts = schedules.filter((s) => s.shift_date === iso);
                const avail = availByDate[iso];
                return (
                  <div key={iso}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
                        {d.toLocaleDateString("en-US", { weekday: "long" })} <span className="text-zinc-600">{d.toLocaleDateString("en-US", { day: "numeric", month: "short" })}</span>
                        {avail?.preferred && <span className="w-2 h-2 rounded-full bg-emerald-400" title="Preferred by a team member" />}
                        {avail?.unavailable && <span className="w-2 h-2 rounded-full bg-rose-500" title="A team member is unavailable" />}
                      </p>
                      <button onClick={() => setModal({ existing: null, date: iso })} className="w-6 h-6 rounded-md bg-[#FF6B35]/15 text-[#FF6B35] flex items-center justify-center hover:bg-[#FF6B35]/25 transition-colors">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    </div>
                    {dayShifts.length === 0 ? (
                      <p className="text-xs text-zinc-600 pl-1">No shifts</p>
                    ) : (
                      <div className="flex flex-col gap-2">{dayShifts.map(shiftLine)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── MONTH VIEW ── */}
      {scheduleView === "Month" && (
        <>
          <div className="flex items-center justify-between">
            <button onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <p className="text-sm font-semibold text-white">{monthAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
            <button onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-[10px] font-semibold text-zinc-500 uppercase py-1">{d}</div>
            ))}
            {loading ? (
              Array.from({ length: 42 }).map((_, i) => <div key={i} className="aspect-square rounded-lg bg-white/[0.02] border border-white/[0.06] animate-pulse" />)
            ) : (
              monthCells.map((d) => {
                const iso = toISODate(d);
                const count = countByDate[iso] ?? 0;
                const inMonth = d.getMonth() === monthAnchor.getMonth();
                return (
                  <button
                    key={iso}
                    onClick={() => { setWeekStart(mondayOf(d)); setScheduleView("Week"); }}
                    className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${inMonth ? "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]" : "border-transparent bg-transparent text-zinc-700"}`}
                  >
                    <span className={`text-xs ${inMonth ? "text-zinc-300" : "text-zinc-700"}`}>{d.getDate()}</span>
                    {count > 0 && (
                      <span className="rounded-full bg-[#FF6B35] text-white text-[9px] font-bold min-w-[16px] h-4 px-1 flex items-center justify-center">{count}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── OPEN SHIFTS VIEW ── */}
      {scheduleView === "Open Shifts" && (
        loading ? <Skeleton count={4} /> : openShifts.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
            title="No open shifts"
            sub="Post an open shift with the + button. Jobs posted via the Jobs tab also appear here for your team to claim."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {openShifts.map((s) => {
              const claims = claimsBySchedule[s.id] ?? [];
              const approved = claims.filter((c) => c.status === "approved").length;
              const remaining = Math.max(0, (s.max_staff ?? 1) - approved);
              return (
                <div key={s.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{fmtDate(s.shift_date)}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {fmtTime(s.start_time)} – {fmtTime(s.end_time)}{s.role ? ` · ${s.role}` : ""}
                      </p>
                      {s.location && <p className="text-xs text-zinc-600 mt-0.5">{s.location}</p>}
                      {s.requirements && <p className="text-xs text-amber-400 mt-1">{s.requirements}</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-[#FF6B35]/10 px-2.5 py-1 text-[10px] font-semibold text-[#FF6B35]">
                      {remaining} spot{remaining !== 1 ? "s" : ""} left
                    </span>
                  </div>

                  <div className="mt-3 pt-3 border-t border-white/[0.05]">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Claimants ({claims.length})</p>
                    {claims.length === 0 ? (
                      <p className="text-xs text-zinc-600">No claims yet.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {claims.map((c) => (
                          <div key={c.id} className="flex items-center gap-3">
                            <span className="flex-1 text-sm text-zinc-300 truncate">{c.staff?.full_name ?? c.staff_id}</span>
                            {c.status === "approved" ? (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Approved</span>
                            ) : c.status === "rejected" ? (
                              <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">Rejected</span>
                            ) : (
                              <div className="flex gap-2">
                                <button onClick={() => approveClaim(s, c)} className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-600/40 transition-colors">Approve</button>
                                <button onClick={() => rejectClaim(c)} className="rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 px-2.5 py-1 text-xs font-semibold hover:bg-rose-600/40 transition-colors">Reject</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {modal && (
        <ShiftModal
          vendorId={vendorId}
          staff={staff}
          trucks={trucks}
          events={events}
          existing={modal.existing}
          defaultDate={modal.date}
          onClose={() => setModal(null)}
          onSaved={loadSchedules}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TIMESHEETS TAB
// ════════════════════════════════════════════════════════════════════════════

type TShift = { id: string; staff_id: string; staff_name: string; event_name: string; truck_name: string; clock_in_time: string | null; clock_out_time: string | null; hours_worked: number; total_pay: number; custom: boolean };

function TimesheetsTab({ vendorId }: { vendorId: string }) {
  const [shifts, setShifts] = useState<TShift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [shiftRes, payRes] = await Promise.all([
        supabase.from("shifts").select("*, events(name), vendor_trucks(name)").eq("vendor_id", vendorId).eq("status", "completed").order("clock_out_time", { ascending: false }),
        supabase.from("staff_pay_rates").select("staff_id").eq("employer_id", vendorId),
      ]);
      const rows = (shiftRes.data ?? []) as any[];
      const overrideStaff = new Set(((payRes.data ?? []) as any[]).map((r) => r.staff_id));
      const staffIds = [...new Set(rows.map((r) => r.staff_id))];
      let nameMap: Record<string, string> = {};
      if (staffIds.length) {
        const { data: users } = await supabase.from("users").select("id, full_name").in("id", staffIds);
        nameMap = Object.fromEntries(((users ?? []) as any[]).map((u) => [u.id, u.full_name]));
      }
      setShifts(rows.map((r) => ({
        id: r.id, staff_id: r.staff_id, staff_name: nameMap[r.staff_id] ?? "Unknown",
        event_name: r.events?.name ?? "No Event", truck_name: r.vendor_trucks?.name ?? "No Truck",
        clock_in_time: r.clock_in_time ?? null, clock_out_time: r.clock_out_time ?? null,
        hours_worked: r.hours_worked ?? hoursBetween(r.clock_in_time, r.clock_out_time), total_pay: r.total_pay ?? 0,
        custom: overrideStaff.has(r.staff_id),
      })));
      setLoading(false);
    }
    load();
  }, [vendorId]);

  if (loading) return <Skeleton count={5} />;
  if (shifts.length === 0) return <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>} title="No timesheets yet" sub="Completed shifts will appear here." />;

  const totalHours = shifts.reduce((s, r) => s + r.hours_worked, 0);
  const totalWages = shifts.reduce((s, r) => s + r.total_pay, 0);

  // Group Event → Truck
  const byEvent: Record<string, Record<string, TShift[]>> = {};
  for (const s of shifts) ((byEvent[s.event_name] ??= {})[s.truck_name] ??= []).push(s);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center">
          <p className="text-xl font-bold text-white">{shifts.length}</p>
          <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">Shifts</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center">
          <p className="text-xl font-bold text-white">{totalHours.toFixed(1)}</p>
          <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">Hours</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center">
          <p className="text-xl font-bold text-[#FF6B35]">${totalWages.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">Wages</p>
        </div>
      </div>

      {Object.entries(byEvent).map(([eventName, trucks]) => (
        <div key={eventName}>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">{eventName}</p>
          <div className="flex flex-col gap-4">
            {Object.entries(trucks).map(([truckName, list]) => (
              <div key={truckName}>
                <p className="text-xs font-medium text-zinc-500 mb-2">🚚 {truckName}</p>
                <div className="flex flex-col gap-2">
                  {list.map((s) => (
                    <div key={s.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{s.staff_name}</p>
                          {s.custom && <span className="rounded-full bg-[#FF6B35]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FF6B35] shrink-0">CUSTOM</span>}
                        </div>
                        <p className="text-sm font-semibold text-[#FF6B35] shrink-0">${s.total_pay.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {fmtDate(s.clock_in_time)} · {fmtTime(s.clock_in_time)} → {fmtTime(s.clock_out_time)} · {s.hours_worked.toFixed(1)}h
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// INVOICES TAB (contractor invoices)
// ════════════════════════════════════════════════════════════════════════════

type Invoice = {
  id: string;
  staff_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  hours_worked: number | null;
  rate: number | null;
  subtotal: number | null;
  gst: number | null;
  total: number | null;
  status: string;
  staff_name: string;
  abn: string | null;
};

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function InvoicesTab({ vendorId }: { vendorId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<"pending" | "approved" | "paid">("pending");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("contractor_invoices").select("*").eq("vendor_id", vendorId).order("invoice_date", { ascending: false });
    const rows = (data ?? []) as any[];
    const staffIds = [...new Set(rows.map((r) => r.staff_id).filter(Boolean))];
    let nameMap: Record<string, string> = {}, abnMap: Record<string, string | null> = {};
    if (staffIds.length) {
      const [u, sp] = await Promise.all([
        supabase.from("users").select("id, full_name").in("id", staffIds),
        supabase.from("staff_profiles").select("user_id, abn").in("user_id", staffIds),
      ]);
      nameMap = Object.fromEntries(((u.data ?? []) as any[]).map((x) => [x.id, x.full_name]));
      abnMap = Object.fromEntries(((sp.data ?? []) as any[]).map((x) => [x.user_id, x.abn]));
    }
    setInvoices(rows.map((r) => ({ ...r, staff_name: nameMap[r.staff_id] ?? "Unknown", abn: abnMap[r.staff_id] ?? null })));
    setLoading(false);
  }, [vendorId]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    await createClient().from("contractor_invoices").update({ status }).eq("id", id);
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
  }

  const filtered = invoices.filter((i) => (i.status ?? "pending").toLowerCase() === sub);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(["pending", "approved", "paid"] as const).map((s) => (
          <button key={s} onClick={() => setSub(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${sub === s ? "bg-[#FF6B35] text-white" : "bg-[#1a1a1a] text-zinc-400 hover:text-white"}`}>
            {s} ({invoices.filter((i) => (i.status ?? "pending").toLowerCase() === s).length})
          </button>
        ))}
      </div>

      {loading ? <Skeleton count={3} /> : filtered.length === 0 ? (
        <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>} title={`No ${sub} invoices`} />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((inv) => (
            <div key={inv.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{inv.staff_name}</p>
                  <p className="text-xs text-zinc-500">ABN: {inv.abn ?? "—"}</p>
                  <p className="text-xs text-zinc-600 mt-0.5">{inv.invoice_number ?? "Invoice"} · {fmtDate(inv.invoice_date)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                  inv.status === "paid" ? "bg-emerald-500/10 text-emerald-400" :
                  inv.status === "approved" ? "bg-blue-500/10 text-blue-300" :
                  inv.status === "declined" ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-400"
                }`}>{(inv.status ?? "pending").toUpperCase()}</span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs text-zinc-400">
                <span>Hours: <span className="text-zinc-200">{inv.hours_worked ?? "—"}</span></span>
                <span>Rate: <span className="text-zinc-200">{inv.rate != null ? money(inv.rate) : "—"}</span></span>
                <span>Subtotal: <span className="text-zinc-200">{inv.subtotal != null ? money(inv.subtotal) : "—"}</span></span>
                <span>GST: <span className="text-zinc-200">{inv.gst != null ? money(inv.gst) : "—"}</span></span>
                <span className="col-span-2">Total: <span className="text-white font-semibold">{inv.total != null ? money(inv.total) : "—"}</span></span>
              </div>

              {(inv.status === "pending" || !inv.status) && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setStatus(inv.id, "approved")} className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-600/40 transition-colors">Approve</button>
                  <button onClick={() => setStatus(inv.id, "declined")} className="rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-600/40 transition-colors">Decline</button>
                </div>
              )}
              {inv.status === "approved" && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setStatus(inv.id, "paid")} className="rounded-lg bg-[#FF6B35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#ff7d4d] transition-colors">Mark as Paid</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAYROLL TAB (employees export + TPAR)
// ════════════════════════════════════════════════════════════════════════════

type PayrollRow = { staff_id: string; name: string; abn: string | null; date: string | null; hours: number; rate: number; mult: number; total: number };

function EmployeesPayroll({ vendorId }: { vendorId: string }) {
  const [range, setRange] = useState<"week" | "month" | "custom">("week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);

  const bounds = useCallback((): [string, string] | null => {
    const now = new Date();
    if (range === "week") { const s = mondayOf(now); const e = new Date(s); e.setDate(e.getDate() + 6); return [toISODate(s), toISODate(e)]; }
    if (range === "month") { const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); return [toISODate(s), toISODate(e)]; }
    return customStart && customEnd ? [customStart, customEnd] : null;
  }, [range, customStart, customEnd]);

  const load = useCallback(async () => {
    const b = bounds();
    if (!b) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("shifts").select("staff_id, clock_in_time, hours_worked, total_pay")
      .eq("vendor_id", vendorId).eq("status", "completed")
      .gte("clock_in_time", b[0] + "T00:00:00").lte("clock_in_time", b[1] + "T23:59:59")
      .order("clock_in_time", { ascending: true });
    const shifts = (data ?? []) as any[];
    const staffIds = [...new Set(shifts.map((s) => s.staff_id).filter(Boolean))];
    let nameMap: Record<string, string> = {}, abnMap: Record<string, string | null> = {};
    if (staffIds.length) {
      const [u, sp] = await Promise.all([
        supabase.from("users").select("id, full_name").in("id", staffIds),
        supabase.from("staff_profiles").select("user_id, abn").in("user_id", staffIds),
      ]);
      nameMap = Object.fromEntries(((u.data ?? []) as any[]).map((x) => [x.id, x.full_name]));
      abnMap = Object.fromEntries(((sp.data ?? []) as any[]).map((x) => [x.user_id, x.abn]));
    }
    setRows(shifts.map((s) => {
      const hours = s.hours_worked ?? 0;
      const total = s.total_pay ?? 0;
      const info = awardInfo((s.clock_in_time ?? "").slice(0, 10), (s.clock_in_time ?? "").slice(11, 16));
      return { staff_id: s.staff_id, name: nameMap[s.staff_id] ?? "Unknown", abn: abnMap[s.staff_id] ?? null, date: s.clock_in_time, hours, rate: hours > 0 ? total / hours : 0, mult: info.mult, total };
    }));
    setLoading(false);
  }, [vendorId, bounds]);
  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    downloadCsv(`payroll-employees-${toISODate(new Date())}.csv`, [
      ["Staff Name", "ABN", "Date", "Hours", "Rate", "Award Multiplier", "Total"],
      ...rows.map((r) => [r.name, r.abn ?? "", fmtDate(r.date), r.hours.toFixed(2), r.rate.toFixed(2), `${r.mult}×`, r.total.toFixed(2)]),
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["week", "month", "custom"] as const).map((r) => (
          <button key={r} onClick={() => setRange(r)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${range === r ? "bg-[#FF6B35] text-white" : "bg-[#1a1a1a] text-zinc-400 hover:text-white"}`}>
            {r === "week" ? "This Week" : r === "month" ? "This Month" : "Custom"}
          </button>
        ))}
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-white outline-none focus:border-[#FF6B35] [color-scheme:dark]" />
            <span className="text-xs text-zinc-500">→</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-white outline-none focus:border-[#FF6B35] [color-scheme:dark]" />
          </div>
        )}
        <div className="flex-1" />
        <button onClick={exportCsv} disabled={rows.length === 0} className="rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors disabled:opacity-40">Download CSV</button>
      </div>

      {loading ? <Skeleton count={4} /> : rows.length === 0 ? (
        <p className="text-sm text-zinc-600 py-8 text-center">No completed shifts in this range.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-zinc-500">
                <th className="px-3 py-2.5 text-left font-medium">Staff</th>
                <th className="px-3 py-2.5 text-left font-medium">ABN</th>
                <th className="px-3 py-2.5 text-left font-medium">Date</th>
                <th className="px-3 py-2.5 text-right font-medium">Hrs</th>
                <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                <th className="px-3 py-2.5 text-right font-medium">Mult</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-white/[0.04]">
                  <td className="px-3 py-2 text-zinc-300">{r.name}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.abn ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.hours.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{money(r.rate)}</td>
                  <td className="px-3 py-2 text-right text-amber-400">{r.mult}×</td>
                  <td className="px-3 py-2 text-right text-white">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const FY_OPTIONS: [string, string, string][] = [
  ["2024-25", "2024-07-01", "2025-06-30"],
  ["2025-26", "2025-07-01", "2026-06-30"],
  ["2026-27", "2026-07-01", "2027-06-30"],
];

function TparPayroll({ vendorId }: { vendorId: string }) {
  const [fy, setFy] = useState("2025-26");
  const [rows, setRows] = useState<{ name: string; abn: string | null; exGst: number; gst: number; gross: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const bounds = FY_OPTIONS.find((f) => f[0] === fy);
    const { data } = await supabase.from("contractor_invoices").select("staff_id, subtotal, gst, total, invoice_date, status")
      .eq("vendor_id", vendorId).eq("status", "paid")
      .gte("invoice_date", bounds![1]).lte("invoice_date", bounds![2]);
    const invs = (data ?? []) as any[];
    const staffIds = [...new Set(invs.map((r) => r.staff_id).filter(Boolean))];
    let nameMap: Record<string, string> = {}, abnMap: Record<string, string | null> = {};
    if (staffIds.length) {
      const [u, sp] = await Promise.all([
        supabase.from("users").select("id, full_name").in("id", staffIds),
        supabase.from("staff_profiles").select("user_id, abn").in("user_id", staffIds),
      ]);
      nameMap = Object.fromEntries(((u.data ?? []) as any[]).map((x) => [x.id, x.full_name]));
      abnMap = Object.fromEntries(((sp.data ?? []) as any[]).map((x) => [x.user_id, x.abn]));
    }
    const byStaff: Record<string, { name: string; abn: string | null; exGst: number; gst: number; gross: number }> = {};
    for (const inv of invs) {
      const k = inv.staff_id;
      if (!byStaff[k]) byStaff[k] = { name: nameMap[k] ?? "Unknown", abn: abnMap[k] ?? null, exGst: 0, gst: 0, gross: 0 };
      byStaff[k].exGst += inv.subtotal ?? 0;
      byStaff[k].gst += inv.gst ?? 0;
      byStaff[k].gross += inv.total ?? 0;
    }
    setRows(Object.values(byStaff));
    setLoading(false);
  }, [vendorId, fy]);
  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    downloadCsv(`tpar-${fy}.csv`, [
      ["Payee ABN", "Payee Name", "Total Payments (excl GST)", "Total GST", "Gross Amount"],
      ...rows.map((r) => [r.abn ?? "", r.name, r.exGst.toFixed(2), r.gst.toFixed(2), r.gross.toFixed(2)]),
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <select value={fy} onChange={(e) => setFy(e.target.value)} className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-1.5 text-sm text-white outline-none focus:border-[#FF6B35] [color-scheme:dark]">
          {FY_OPTIONS.map(([label]) => <option key={label} value={label}>FY {label}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={exportCsv} disabled={rows.length === 0} className="rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors disabled:opacity-40">Download TPAR CSV</button>
      </div>

      {loading ? <Skeleton count={3} /> : rows.length === 0 ? (
        <p className="text-sm text-zinc-600 py-8 text-center">No paid contractor invoices in FY {fy}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-zinc-500">
                <th className="px-3 py-2.5 text-left font-medium">Name</th>
                <th className="px-3 py-2.5 text-left font-medium">ABN</th>
                <th className="px-3 py-2.5 text-right font-medium">Total (ex GST)</th>
                <th className="px-3 py-2.5 text-right font-medium">GST</th>
                <th className="px-3 py-2.5 text-right font-medium">Gross</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-white/[0.04]">
                  <td className="px-3 py-2 text-zinc-300">{r.name}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.abn ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{money(r.exGst)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{money(r.gst)}</td>
                  <td className="px-3 py-2 text-right text-white">{money(r.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-500 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        Lodge your TPAR with the ATO by 28 August each year via the ATO Business Portal or through your tax agent.
      </p>
    </div>
  );
}

function PayrollTab({ vendorId }: { vendorId: string }) {
  const [sub, setSub] = useState<"employees" | "tpar">("employees");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {([["employees", "Employees"], ["tpar", "TPAR"]] as ["employees" | "tpar", string][]).map(([key, label]) => (
          <button key={key} onClick={() => setSub(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${sub === key ? "bg-[#FF6B35] text-white" : "bg-[#1a1a1a] text-zinc-400 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>
      {sub === "employees" ? <EmployeesPayroll vendorId={vendorId} /> : <TparPayroll vendorId={vendorId} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function VendorTeamPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [tab, setTab] = useState<Tab>("staff");

  if (authLoading || !user) {
    return (
      <div className="max-w-3xl mx-auto px-5 py-8">
        <h1 className="text-xl font-bold text-white mb-6">Team</h1>
        <Skeleton count={4} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <h1 className="text-xl font-bold text-white mb-6">Team</h1>

      <div className="flex gap-0 mb-6 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
        {([["staff", "My Staff"], ["schedule", "Schedule"], ["timesheets", "Timesheets"], ["invoices", "Invoices"], ["payroll", "Payroll"]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${tab === key ? "text-white border-[#FF6B35]" : "text-zinc-500 border-transparent hover:text-zinc-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "staff" && <MyStaffTab vendorId={user.id} />}
      {tab === "schedule" && <ScheduleTab vendorId={user.id} />}
      {tab === "timesheets" && <TimesheetsTab vendorId={user.id} />}
      {tab === "invoices" && <InvoicesTab vendorId={user.id} />}
      {tab === "payroll" && <PayrollTab vendorId={user.id} />}
    </div>
  );
}

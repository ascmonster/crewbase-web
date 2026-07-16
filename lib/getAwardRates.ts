import { createClient } from "@/lib/supabase";

/* ────────────────────────────────────────────────────────────────────────────
 * FWC award rate helpers — parity with the mobile app.
 *
 * These read the shared Supabase tables that the backend sync populates:
 *   award_rates_live      — base (adult) minimum rates per award + classification
 *   award_penalties_live  — penalty rates per award, per employment type
 *   award_allowances_live — allowances per award
 *
 * None of these tables are otherwise referenced in the web codebase, so their
 * exact column names are unverified here. Rows are normalized defensively (see
 * the norm* helpers) to tolerate common column-name variants — the same
 * convention used elsewhere in this repo (e.g. the documents page `normDoc`).
 * ──────────────────────────────────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Pinned awards ────────────────────────────────────────────────────────────

// The 5 awards most relevant to events staffing. Order is intentional and is
// preserved in the "Recommended for Events" group of the award selector.
export const AWARD_CODES: Record<string, string> = {
  MA000009: "Hospitality",
  MA000119: "Restaurant",
  MA000003: "Fast Food",
  MA000004: "Retail",
  MA000080: "Events",
};

export type AwardOption = { code: string; name: string };

// Pinned awards, in display order.
export const RECOMMENDED_AWARDS: AwardOption[] = Object.entries(AWARD_CODES).map(
  ([code, name]) => ({ code, name }),
);

// Resolve an award name (e.g. "Hospitality") back to its MA code. Per-staff
// assignments store the award as a name, but the guidelines are keyed by code.
export function awardCodeForName(name: string | null | undefined): string | null {
  if (!name) return null;
  const hit = Object.entries(AWARD_CODES).find(([, n]) => n.toLowerCase() === name.toLowerCase());
  return hit ? hit[0] : null;
}

// ── Junior rates ─────────────────────────────────────────────────────────────

// Junior pay is a fixed percentage of the adult minimum, by age. Matches the
// mobile app's percentages exactly.
export function getJuniorPercentage(age: number): number {
  if (age < 16) return 0.368;
  if (age === 16) return 0.473;
  if (age === 17) return 0.578;
  if (age === 18) return 0.683;
  if (age === 19) return 0.788;
  if (age === 20) return 0.893;
  return 1.0; // 21 and over — adult rate
}

// Whole-year age from a date-of-birth string (YYYY-MM-DD or ISO). Returns null
// for missing/unparseable input.
export function calculateAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob.includes("T") ? dob : dob + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type AwardRate = {
  award_code: string;
  award_name: string;
  classification: string;
  base_rate: number;
};

export type PenaltyRate = {
  penalty_name: string;
  casual: number | null;
  permanent: number | null;
};

export type Allowance = {
  allowance_name: string;
  amount: number | null;
  unit: string | null;
};

// ── Normalizers ──────────────────────────────────────────────────────────────

function num(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function normRate(raw: any): AwardRate {
  return {
    award_code: raw.award_code ?? raw.code ?? "",
    award_name: raw.award_name ?? raw.name ?? AWARD_CODES[raw.award_code] ?? raw.award_code ?? "",
    classification:
      raw.classification ?? raw.classification_name ?? raw.level ?? raw.grade ?? "Base rate",
    base_rate: num(raw.base_rate ?? raw.hourly_rate ?? raw.base_hourly_rate ?? raw.rate) ?? 0,
  };
}

function isCasual(type: any): boolean {
  return String(type ?? "").toLowerCase().includes("casual");
}

// ── Queries ──────────────────────────────────────────────────────────────────

// Top 5 FWC minimums for an award, cheapest classification first. `employeeType`
// is accepted for API parity with mobile; junior figures are derived from these
// adult base rates via getJuniorPercentage() in the UI (junior pay is age-based,
// so it isn't stored as separate rows).
export async function getAwardRateGuidelines(
  awardCode: string,
  employeeType: "adult" | "junior" = "adult",
): Promise<AwardRate[]> {
  if (!awardCode) return [];
  void employeeType;
  const { data, error } = await createClient()
    .from("award_rates_live")
    .select("*")
    .eq("award_code", awardCode)
    .order("base_rate", { ascending: true })
    .limit(5);
  if (error || !data) return [];
  return (data as any[]).map(normRate);
}

// Distinct awards (code + name) across award_rates_live, sorted alphabetically
// by name. Used to populate the "All Awards" group of the selector.
export async function getAllAwards(): Promise<AwardOption[]> {
  const { data, error } = await createClient()
    .from("award_rates_live")
    .select("award_code, award_name");
  if (error || !data) return [];
  const byCode = new Map<string, string>();
  for (const r of data as any[]) {
    const code = r.award_code ?? r.code;
    if (!code || byCode.has(code)) continue;
    byCode.set(code, r.award_name ?? r.name ?? AWARD_CODES[code] ?? code);
  }
  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Penalty rates for an award, grouped by penalty name with casual/permanent
// variants side by side.
export async function getPenaltyRates(awardCode: string): Promise<PenaltyRate[]> {
  if (!awardCode) return [];
  const { data, error } = await createClient()
    .from("award_penalties_live")
    .select("*")
    .eq("award_code", awardCode);
  if (error || !data) return [];

  const grouped = new Map<string, PenaltyRate>();
  for (const r of data as any[]) {
    const name = r.penalty_name ?? r.name ?? "Penalty";
    const value = num(r.rate ?? r.multiplier ?? r.penalty_rate ?? r.percentage ?? r.value);
    const entry = grouped.get(name) ?? { penalty_name: name, casual: null, permanent: null };
    if (isCasual(r.employment_type ?? r.employee_type ?? r.type)) entry.casual = value;
    else entry.permanent = value;
    grouped.set(name, entry);
  }
  return [...grouped.values()];
}

// Allowances for an award.
export async function getAllowances(awardCode: string): Promise<Allowance[]> {
  if (!awardCode) return [];
  const { data, error } = await createClient()
    .from("award_allowances_live")
    .select("*")
    .eq("award_code", awardCode);
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    allowance_name: r.allowance_name ?? r.name ?? "Allowance",
    amount: num(r.amount ?? r.rate ?? r.value),
    unit: r.unit ?? r.per ?? null,
  }));
}

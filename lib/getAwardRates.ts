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

export type PenaltyVariant = {
  label: string;
  rate: number | null;
  multiplier: number | null;
};

export type PenaltyRate = {
  name: string;
  variants: PenaltyVariant[];
};

// Saturday / Sunday / Public-holiday penalty rows, one variant per FWC row.
export type DayPenaltyVariant = {
  label: string;        // the penalty_type text, e.g. "Adult casual"
  rate: number | null;  // FWC calculated_rate ($/hr) — never multiplied
  isCasual: boolean;    // penalty_type contains "casual"
};
export type DayPenalty = {
  name: string;         // penalty_name, e.g. "Saturday"
  variants: DayPenaltyVariant[];
};

export type Allowance = {
  name: string;
  rate: number | null;
  rateType: string | null; // 'Percent' | 'Hourly' | 'Weekly' | 'Daily' | …
  unit: string | null;     // descriptive per-unit text (from allowance_type)
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

// Human-readable label for a penalty_type value ("casual" → "Casual",
// "full_time" → "Full Time", empty → "Permanent").
function penaltyTypeLabel(raw: any): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Permanent";
  if (s.toLowerCase().includes("casual")) return "Casual";
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Trim a penalty_type label at the em-dash / en-dash — FWC appends boilerplate
// after it (e.g. "Casual adult employees—ordinary and penalty rates" →
// "Casual adult employees"). Only the em/en dash is cut, never the hyphen in
// "full-time"/"part-time". Mirrors the mobile penaltyLabel() cleanup.
function cleanPenaltyLabel(typeText: any): string {
  const s = String(typeText ?? "").split(/[—–]/)[0].trim().replace(/\s+/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Standard";
}

// ── Queries ──────────────────────────────────────────────────────────────────

// Top 5 FWC minimums for an award, cheapest classification first.
//
// IMPORTANT: award_rates_live carries a row per employee type (adult, junior,
// apprentice, …). We must filter to `employee_type = 'adult'` — without it,
// ordering by base_rate ascending surfaces junior/apprentice rows (a fraction
// of the adult minimum), which is what caused rates to display as ~$0.92
// instead of the real ~$27 adult minimum. `employeeType` is accepted for API
// parity; adult base rates are always returned and junior figures are derived
// in the UI via getJuniorPercentage() (junior rows aren't published for every
// award), matching the mobile app.
export async function getAwardRateGuidelines(
  awardCode: string,
  employeeType: "adult" | "junior" = "adult",
): Promise<AwardRate[]> {
  if (!awardCode) return [];
  void employeeType;
  const { data, error } = await createClient()
    .from("award_rates_live")
    .select("classification_name, parent_classification_name, base_rate, employee_type, award_code, award_name")
    .eq("award_code", awardCode)
    .eq("employee_type", "adult")
    .order("base_rate", { ascending: true })
    .limit(10);
  if (error || !data) return [];

  // award_rates_live can hold more than one row per classification (e.g. per
  // parent classification / pay frequency). Dedupe by classification_name so
  // each appears once, drop non-positive rows, then keep the 5 cheapest.
  const seen = new Set<string>();
  const out: AwardRate[] = [];
  for (const raw of data as any[]) {
    const r = normRate(raw);
    if (!(r.base_rate > 0)) continue;
    const key = r.classification.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 5) break;
  }
  return out;
}

// Distinct awards (code + name) across award_rates_live, sorted alphabetically
// by name. A single Supabase request is capped (~1000 rows) server-side, so we
// page through in 1000-row batches until a short page signals the end —
// otherwise the "All Awards" list is silently truncated. Mirrors the mobile app.
export async function getAllAwards(): Promise<AwardOption[]> {
  const supabase = createClient();
  const PAGE = 1000;
  const byCode = new Map<string, string>();

  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await supabase
      .from("award_rates_live")
      .select("award_code, award_name")
      .order("award_code", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as any[]) {
      const code = r.award_code ?? r.code;
      if (!code || byCode.has(code)) continue;
      byCode.set(code, r.award_name ?? r.name ?? AWARD_CODES[code] ?? code);
    }
    if (data.length < PAGE) break;
  }

  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Penalty rates for an award, grouped by penalty_name. Within each group the
// variants are split by penalty_type (casual vs permanent/full-time), each
// carrying its own dollar rate and/or multiplier. Mirrors the mobile
// AwardRateGuide.js grouping.
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
    const label = penaltyTypeLabel(r.penalty_type ?? r.employment_type ?? r.employee_type ?? r.type);
    const rate = num(r.rate ?? r.penalty_rate ?? r.hourly_rate ?? r.value);
    const multiplier = num(r.multiplier ?? r.penalty_multiplier ?? r.percentage);
    const entry: PenaltyRate = grouped.get(name) ?? { name, variants: [] };
    entry.variants.push({ label, rate, multiplier });
    grouped.set(name, entry);
  }
  // Show the casual variant first within each penalty.
  for (const entry of grouped.values()) {
    entry.variants.sort((a, b) => (a.label === "Casual" ? -1 : b.label === "Casual" ? 1 : 0));
  }
  return [...grouped.values()];
}

// Saturday / Sunday / Public-holiday penalty rates for an award, straight from
// award_penalties_live. Grouped by penalty_name; each variant is one FWC row,
// labelled by its penalty_type text (e.g. "Adult casual", "Casual managerial
// (Hotels)") and carrying FWC's own calculated_rate ($/hr) — NEVER multiplied.
// Casual vs permanent is derived from whether penalty_type contains "casual".
export async function getDayPenaltyRates(awardCode: string): Promise<DayPenalty[]> {
  if (!awardCode) return [];
  const { data, error } = await createClient()
    .from("award_penalties_live")
    .select("*")
    .eq("award_code", awardCode)
    .or("penalty_name.ilike.%Saturday%,penalty_name.ilike.%Sunday%,penalty_name.ilike.%Public holiday%");
  if (error || !data) return [];

  const grouped = new Map<string, DayPenalty>();
  for (const r of data as any[]) {
    // Adult rows only — employee_rate_type_code is the age/apprentice axis
    // (AD = adult), not the casual/permanent axis.
    const ert = r.employee_rate_type_code;
    if (ert && ert !== "AD") continue;
    const rate = num(r.calculated_rate ?? r.penalty_calculated_value);
    if (rate == null) continue;
    const name = r.penalty_name ?? r.penalty_description ?? "Penalty";
    const ptype = String(r.penalty_type ?? r.clause_description ?? "").trim();
    // Clean the label BEFORE using it as the dedup key so rows that differ only
    // in the trimmed boilerplate collapse into one variant.
    const label = cleanPenaltyLabel(ptype);
    const isCasual = /casual/i.test(ptype);
    const entry: DayPenalty = grouped.get(name) ?? { name, variants: [] };
    if (!entry.variants.some((v) => v.label === label && v.rate === rate)) {
      entry.variants.push({ label, rate, isCasual });
    }
    grouped.set(name, entry);
  }
  for (const e of grouped.values()) {
    e.variants.sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
  }
  // Present in a natural order: Saturday, Sunday, Public holiday, then the rest.
  const rank = (n: string) =>
    /saturday/i.test(n) ? 0 : /sunday/i.test(n) ? 1 : /public/i.test(n) ? 2 : 3;
  return [...grouped.values()].sort((a, b) => rank(a.name) - rank(b.name));
}

// Allowances for an award. The FWC wage-allowances endpoint also returns rows
// that aren't true allowances — penalty rows (name starts with "Penalty") and
// classification rows (Level N / Introductory / Grade N) — so we filter those
// out. `rate` may be a dollar amount OR a percentage; `rateType` says which.
export async function getAllowances(awardCode: string): Promise<Allowance[]> {
  if (!awardCode) return [];
  const { data, error } = await createClient()
    .from("award_allowances_live")
    .select("*")
    .eq("award_code", awardCode);
  if (error || !data) return [];
  const CLASSIFICATION_RE = /^(Level \d|Introductory|Grade \d)/i;
  return (data as any[])
    .map((r) => ({
      name: r.allowance_name ?? r.name ?? "Allowance",
      rate: num(r.calculated_rate ?? r.amount ?? r.rate ?? r.value),
      rateType: r.calculated_rate_type ?? r.rate_type ?? null,
      unit: r.allowance_type ?? r.unit ?? r.per ?? null,
    }))
    .filter((a) => !/^Penalty/i.test(a.name) && !CLASSIFICATION_RE.test(a.name));
}

"use client";

import { useEffect, useState } from "react";
import {
  AWARD_CODES,
  getAllowances,
  getAwardRateGuidelines,
  getDayPenaltyRates,
  getJuniorPercentage,
  getPenaltyRates,
  type Allowance,
  type AwardRate,
  type DayPenalty,
  type PenaltyRate,
  type PenaltyVariant,
} from "@/lib/getAwardRates";

/**
 * Shows the FWC minimum wage guidelines for an award. If a staff age is given
 * and the staffer is under 21, the adult minimums are scaled to the applicable
 * junior percentage. Optionally flags an entered rate that falls below the
 * lowest minimum, and can expand penalty-rate and allowance breakdowns.
 */
export default function AwardRateGuide({
  awardCode,
  staffAge = null,
  staffName = null,
  enteredRate = null,
  showPenaltyRates = false,
  employmentType = "full-time",
  accent = "orange",
}: {
  awardCode: string | null;
  staffAge?: number | null;
  staffName?: string | null;
  enteredRate?: number | null;
  showPenaltyRates?: boolean;
  employmentType?: "casual" | "part-time" | "full-time";
  accent?: "orange" | "violet";
}) {
  const [rates, setRates] = useState<AwardRate[]>([]);
  const [penalties, setPenalties] = useState<PenaltyRate[]>([]);
  const [dayPenalties, setDayPenalties] = useState<DayPenalty[]>([]);
  const [allowances, setAllowances] = useState<Allowance[]>([]);
  const [loading, setLoading] = useState(false);

  const isJunior = staffAge != null && staffAge < 21;
  const juniorPct = isJunior ? getJuniorPercentage(staffAge!) : 1;
  const accentText = accent === "violet" ? "text-violet-400" : "text-[#FF6B35]";

  useEffect(() => {
    if (!awardCode) {
      setRates([]);
      setPenalties([]);
      setAllowances([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getAwardRateGuidelines(awardCode, isJunior ? "junior" : "adult"),
      showPenaltyRates ? getPenaltyRates(awardCode) : Promise.resolve([] as PenaltyRate[]),
      getAllowances(awardCode),
      getDayPenaltyRates(awardCode),
    ]).then(([r, p, a, d]) => {
      if (cancelled) return;
      setRates(r);
      setPenalties(p);
      setAllowances(a);
      setDayPenalties(d);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [awardCode, isJunior, showPenaltyRates]);

  if (!awardCode) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <p className="text-xs text-zinc-500">Select an award to see FWC rate guidelines.</p>
      </div>
    );
  }

  // Displayed base hourly rate: adult minimum, junior-scaled when the staffer is
  // a junior. No casual multiplier — casual/weekend/PH loadings are shown as the
  // actual FWC penalty rows below (see DayRatesSection), never multiplied.
  const isCasual = employmentType === "casual";
  const displayRate = (base: number) => base * juniorPct;
  const lowestMinimum = rates.length > 0 ? Math.min(...rates.map((r) => displayRate(r.base_rate))) : null;

  // Header note describing which rate basis is shown.
  const ageNote = (() => {
    if (staffAge != null) {
      const who = staffName ? `${staffName}'s` : "this staff member's";
      return `Based on ${who} age (${staffAge}), showing ${isJunior ? "Junior" : "Adult"} FWC rates`;
    }
    return "Showing adult rates";
  })();

  const awardLabel = rates[0]?.award_name ?? AWARD_CODES[awardCode] ?? awardCode;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-white">FWC Rate Guidelines</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {awardLabel} <span className="text-zinc-600">({awardCode})</span>
        </p>
        <p className={`text-xs mt-1 ${isJunior ? accentText : "text-zinc-500"}`}>{ageNote}</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-lg bg-white/[0.04] animate-pulse" />)}
        </div>
      ) : rates.length === 0 ? (
        <p className="text-xs text-zinc-500">No published rates found for this award.</p>
      ) : (
        <>
          {/* Top 5 minimums */}
          <div className="flex flex-col divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] overflow-hidden">
            {rates.map((r, i) => (
              <div key={`${r.classification}-${i}`} className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-zinc-400 truncate mr-3">{r.classification}</span>
                <span className="text-sm font-semibold text-white shrink-0">
                  ${displayRate(r.base_rate).toFixed(2)}/hr
                  {isJunior && (
                    <span className="text-[11px] font-normal text-zinc-600 ml-1">
                      (adult ${r.base_rate.toFixed(2)})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Saturday / Sunday / Public-holiday rates — actual FWC penalty rows,
              filtered to the selected casual/permanent basis */}
          <DayRatesSection days={dayPenalties} isCasual={isCasual} accentText={accentText} />

          {/* Entered-rate compliance check — only for a positive rate that has
              actually been entered (0 / blank is treated as "not entered"). */}
          {enteredRate != null && enteredRate > 0 && lowestMinimum != null && (
            enteredRate < lowestMinimum ? (
              <p className="text-xs rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 px-3 py-2">
                ⚠️ This rate may be below the FWC minimum (${lowestMinimum.toFixed(2)}/hr). Please check
                your award obligations.
              </p>
            ) : (
              <p className="text-xs rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-2">
                ✓ Rate meets FWC minimum
              </p>
            )
          )}

          {/* Other penalty rates (opt-in) — Sat/Sun/PH are shown separately above */}
          {showPenaltyRates && (
            <PenaltySection
              penalties={penalties.filter((p) => !/saturday|sunday|public holiday/i.test(p.name))}
            />
          )}

          {/* Allowances — hidden entirely when there are none */}
          <AllowancesSection allowances={allowances} />
        </>
      )}

      <p className="text-[11px] text-zinc-600">Source: Fair Work Commission, effective 1 July 2026</p>
    </div>
  );
}

// Trim a penalty_type label at the em-dash / en-dash — FWC appends boilerplate
// after it (e.g. "Casual adult employees—ordinary and penalty rates" →
// "Casual adult employees"). Only the em/en dash is cut, never the hyphen in
// "full-time"/"part-time". Matches the mobile penaltyLabel() cleanup.
function cleanPenaltyLabel(label: string): string {
  const s = String(label ?? "").split(/[—–]/)[0].trim().replace(/\s+/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : label;
}

// Saturday / Sunday / Public-holiday rates, read straight from FWC penalty rows.
// Variants are filtered to the selected casual/permanent basis; the dollar
// figures are FWC's own calculated_rate — never multiplied by a loading factor.
function DayRatesSection({
  days,
  isCasual,
  accentText,
}: {
  days: DayPenalty[];
  isCasual: boolean;
  accentText: string;
}) {
  const [open, setOpen] = useState(true);
  const filtered = days
    .map((d) => ({ name: d.name, variants: d.variants.filter((v) => v.isCasual === isCasual) }))
    .filter((d) => d.variants.length > 0);
  if (filtered.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.03] transition-colors"
      >
        <span>Weekend &amp; Public Holiday Rates</span>
        <span className="text-zinc-600">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 flex flex-col gap-2">
          {filtered.map((d, i) => (
            <div key={`${d.name}-${i}`} className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-zinc-300">{d.name}</span>
              <div className="flex flex-col gap-0.5">
                {d.variants.map((v, j) => (
                  <span key={`${v.label}-${j}`} className="text-xs text-zinc-400">
                    {cleanPenaltyLabel(v.label)}:{" "}
                    <span className="text-zinc-200">{v.rate != null ? `$${v.rate.toFixed(2)}/hr` : "—"}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className={`text-[11px] mt-1 ${isCasual ? accentText : "text-zinc-600"}`}>
            {isCasual
              ? "FWC casual penalty rates — these already include the 25% casual loading (no extra multiplier applied)."
              : "FWC permanent (full-time / part-time) penalty rates."}
          </p>
        </div>
      )}
    </div>
  );
}

// Format one penalty variant: multiplier and/or dollar rate.
function fmtVariant(v: PenaltyVariant): string {
  const parts: string[] = [];
  if (v.multiplier != null) parts.push(`${v.multiplier.toFixed(2)}×`);
  if (v.rate != null) parts.push(`$${v.rate.toFixed(2)}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function PenaltySection({ penalties }: { penalties: PenaltyRate[] }) {
  const [open, setOpen] = useState(false);
  if (!penalties || penalties.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.03] transition-colors"
      >
        <span>Penalty Rates</span>
        <span className="text-zinc-600">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 flex flex-col gap-2">
          {penalties.map((p, i) => (
            <div key={`${p.name}-${i}`} className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-zinc-300">{p.name}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                {p.variants.map((v, j) => (
                  <span key={`${v.label}-${j}`} className="text-xs text-zinc-400">
                    {v.label}: <span className="text-zinc-200">{fmtVariant(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Format an allowance value: percentage allowances show "5.6%", dollar
// allowances show "$X.XX"; the descriptive unit (if any) is appended.
function fmtAllowance(a: Allowance): string {
  if (a.rate == null) return "—";
  const isPercent = (a.rateType ?? "").toLowerCase() === "percent";
  const val = isPercent ? `${a.rate}%` : `$${a.rate.toFixed(2)}`;
  return a.unit ? `${val} ${a.unit}` : val;
}

function AllowancesSection({ allowances }: { allowances: Allowance[] }) {
  const [open, setOpen] = useState(false);
  if (!allowances || allowances.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.03] transition-colors"
      >
        <span>Allowances</span>
        <span className="text-zinc-600">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 flex flex-col gap-1.5">
          {allowances.map((a, i) => (
            <div key={`${a.name}-${i}`} className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-zinc-300">{a.name}</span>
              <span className="text-xs text-zinc-400">{fmtAllowance(a)}</span>
            </div>
          ))}
          <p className="text-[11px] text-zinc-600 mt-1">
            Percentage allowances are calculated as a % of the award standard rate. See Fair Work for
            details.
          </p>
        </div>
      )}
    </div>
  );
}

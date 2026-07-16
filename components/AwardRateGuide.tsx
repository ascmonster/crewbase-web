"use client";

import { useEffect, useState } from "react";
import {
  AWARD_CODES,
  getAllowances,
  getAwardRateGuidelines,
  getJuniorPercentage,
  getPenaltyRates,
  type Allowance,
  type AwardRate,
  type PenaltyRate,
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
  accent = "orange",
}: {
  awardCode: string | null;
  staffAge?: number | null;
  staffName?: string | null;
  enteredRate?: number | null;
  showPenaltyRates?: boolean;
  accent?: "orange" | "violet";
}) {
  const [rates, setRates] = useState<AwardRate[]>([]);
  const [penalties, setPenalties] = useState<PenaltyRate[]>([]);
  const [allowances, setAllowances] = useState<Allowance[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPenalties, setShowPenalties] = useState(false);
  const [showAllowances, setShowAllowances] = useState(false);

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
    ]).then(([r, p, a]) => {
      if (cancelled) return;
      setRates(r);
      setPenalties(p);
      setAllowances(a);
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

  // Rate applied to display + the min-rate comparison, junior-scaled when relevant.
  const applied = (base: number) => base * juniorPct;
  const lowestMinimum = rates.length > 0 ? Math.min(...rates.map((r) => applied(r.base_rate))) : null;

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
                  ${applied(r.base_rate).toFixed(2)}/hr
                  {isJunior && (
                    <span className="text-[11px] font-normal text-zinc-600 ml-1">
                      (adult ${r.base_rate.toFixed(2)})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Entered-rate compliance check */}
          {enteredRate != null && lowestMinimum != null && (
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

          {/* Penalty rates (opt-in) */}
          {showPenaltyRates && penalties.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowPenalties((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.03] transition-colors"
              >
                <span>Penalty Rates</span>
                <span className="text-zinc-600">{showPenalties ? "−" : "+"}</span>
              </button>
              {showPenalties && (
                <div className="px-3 pb-2">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-xs">
                    <span className="text-zinc-600 font-medium">Penalty</span>
                    <span className="text-zinc-600 font-medium text-right">Casual</span>
                    <span className="text-zinc-600 font-medium text-right">Permanent</span>
                    {penalties.map((p, i) => (
                      <PenaltyRow key={`${p.penalty_name}-${i}`} p={p} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Allowances */}
          {allowances.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAllowances((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.03] transition-colors"
              >
                <span>Allowances</span>
                <span className="text-zinc-600">{showAllowances ? "−" : "+"}</span>
              </button>
              {showAllowances && (
                <div className="px-3 pb-2 flex flex-col gap-1.5">
                  {allowances.map((a, i) => (
                    <div key={`${a.allowance_name}-${i}`} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400 truncate mr-3">{a.allowance_name}</span>
                      <span className="text-zinc-200 shrink-0">
                        {a.amount != null ? `$${a.amount.toFixed(2)}` : "—"}
                        {a.unit ? ` ${a.unit}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-zinc-600">Source: Fair Work Commission, effective 1 July 2026</p>
    </div>
  );
}

function PenaltyRow({ p }: { p: PenaltyRate }) {
  const fmt = (v: number | null) => (v == null ? "—" : v <= 5 ? `${v.toFixed(2)}×` : `$${v.toFixed(2)}`);
  return (
    <>
      <span className="text-zinc-400 truncate">{p.penalty_name}</span>
      <span className="text-zinc-200 text-right">{fmt(p.casual)}</span>
      <span className="text-zinc-200 text-right">{fmt(p.permanent)}</span>
    </>
  );
}

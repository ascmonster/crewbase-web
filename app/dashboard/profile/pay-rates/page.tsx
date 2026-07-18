"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";
import AwardSelector from "@/components/AwardSelector";
import AwardRateGuide from "@/components/AwardRateGuide";

type Toast = { msg: string; ok: boolean };

// Default employment type — persisted on pay_rates.employment_type. The chips
// use hyphenated values; the DB stores underscored ones.
type EmploymentType = "casual" | "part-time" | "full-time";
const EMPLOYMENT_TYPE_OPTIONS: [EmploymentType, string][] = [
  ["casual", "Casual"],
  ["part-time", "Part-time"],
  ["full-time", "Full-time"],
];
const EMP_TO_DB: Record<EmploymentType, string> = { casual: "casual", "part-time": "part_time", "full-time": "full_time" };
function empFromDb(v: string | null | undefined): EmploymentType {
  if (v === "part_time" || v === "part-time") return "part-time";
  if (v === "full_time" || v === "full-time") return "full-time";
  return "casual";
}

export default function PayRatesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [weekday, setWeekday]       = useState("");
  const [weekend, setWeekend]       = useState("");
  const [pubHoliday, setPubHoliday] = useState("");
  const [awardCode, setAwardCode]   = useState<string | null>(null);
  const [employmentType, setEmploymentType] = useState<EmploymentType>("casual");
  const [showPenaltyRates, setShowPenaltyRates] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving]  = useState(false);
  const [toast, setToast]    = useState<Toast | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();
      const [rateRes, profRes] = await Promise.all([
        supabase.from("pay_rates").select("base_rate, saturday_rate, public_holiday_rate, award_code, employment_type").eq("vendor_id", user!.id).maybeSingle(),
        supabase.from("promoter_profiles").select("show_penalty_rates").eq("user_id", user!.id).maybeSingle(),
      ]);
      const data = rateRes.data as { base_rate: number | null; saturday_rate: number | null; public_holiday_rate: number | null; award_code: string | null; employment_type: string | null } | null;
      if (data) {
        if (data.base_rate           != null) setWeekday(String(data.base_rate));
        if (data.saturday_rate       != null) setWeekend(String(data.saturday_rate));
        if (data.public_holiday_rate != null) setPubHoliday(String(data.public_holiday_rate));
        setAwardCode(data.award_code ?? null);
        setEmploymentType(empFromDb(data.employment_type));
      }
      setShowPenaltyRates((profRes.data as { show_penalty_rates: boolean } | null)?.show_penalty_rates === true);
      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  async function toggleShowPenaltyRates() {
    if (!user) return;
    const next = !showPenaltyRates;
    setShowPenaltyRates(next);
    await createClient()
      .from("promoter_profiles")
      .update({ show_penalty_rates: next })
      .eq("user_id", user.id);
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const wd  = parseFloat(weekday)    || null;
    const wk  = parseFloat(weekend)    || null;
    const ph  = parseFloat(pubHoliday) || null;
    const { error } = await createClient()
      .from("pay_rates")
      .upsert(
        {
          vendor_id:           user.id,
          base_rate:           wd,
          evening_rate:        wd,
          saturday_rate:       wk,
          sunday_rate:         wk,
          public_holiday_rate: ph,
          award_code:          awardCode,
          employment_type:     EMP_TO_DB[employmentType],
        },
        { onConflict: "vendor_id" }
      );
    setSaving(false);
    if (error) {
      showToast(error.message, false);
    } else {
      showToast("Pay rates saved", true);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-zinc-500 text-sm">Loading…</span>
      </div>
    );
  }

  const RATES = [
    {
      label:       "Weekday Rate",
      sub:         "Applies to base & evening shifts",
      value:       weekday,
      setter:      setWeekday,
      placeholder: "$24.38/hr",
    },
    {
      label:       "Weekend Rate",
      sub:         "Applies to Saturday & Sunday shifts",
      value:       weekend,
      setter:      setWeekend,
      placeholder: "$36.57/hr",
    },
    {
      label:       "Public Holiday Rate",
      sub:         "Applies to public holiday shifts",
      value:       pubHoliday,
      setter:      setPubHoliday,
      placeholder: "$60.95/hr",
    },
  ];

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xl transition-all ${toast.ok ? "bg-emerald-600" : "bg-rose-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="max-w-lg mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/profile" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold">Pay Rates</h1>
        </div>

        <p className="text-sm text-zinc-500 mb-6">
          Set the default pay rates applied to your staff shifts. These can be overridden per staff member.
        </p>

        <form onSubmit={save} className="flex flex-col gap-4">
          {/* Modern Award selection */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
            <p className="text-sm font-semibold text-white mb-1">Modern Award</p>
            <p className="text-xs text-zinc-500 mb-3">Used to show FWC minimum rate guidelines.</p>
            <AwardSelector value={awardCode} onChange={setAwardCode} accent="violet" />
          </div>

          {/* Show penalty rate breakdowns */}
          <button
            type="button"
            onClick={toggleShowPenaltyRates}
            className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-white">Show Penalty Rate Breakdowns</p>
              <p className="text-xs text-zinc-500 mt-0.5">Display casual/permanent penalty rates in FWC guidelines.</p>
            </div>
            <span className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${showPenaltyRates ? "bg-violet-600" : "bg-white/[0.12]"}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${showPenaltyRates ? "translate-x-5" : ""}`} />
            </span>
          </button>

          {/* Default employment type — persisted to pay_rates.employment_type */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
            <p className="text-sm font-semibold text-white mb-3">Default Employment Type</p>
            <div className="flex items-center gap-1.5">
              {EMPLOYMENT_TYPE_OPTIONS.map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setEmploymentType(val)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    employmentType === val ? "bg-violet-600 text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {RATES.map(({ label, sub, value, setter, placeholder }) => (
            <div key={label} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  placeholder={placeholder.replace("$", "").replace("/hr", "")}
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-7 pr-12 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">/hr</span>
              </div>
            </div>
          ))}

          {/* FWC guideline for the selected award + entered weekday rate */}
          <AwardRateGuide
            awardCode={awardCode}
            enteredRate={weekday.trim() === "" ? null : parseFloat(weekday)}
            showPenaltyRates={showPenaltyRates}
            employmentType={employmentType}
            accent="violet"
          />

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50 mt-2"
          >
            {saving ? "Saving…" : "Save Pay Rates"}
          </button>
        </form>
      </div>
    </>
  );
}

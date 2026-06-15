"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type Toast = { msg: string; ok: boolean };

export default function PayRatesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [weekday, setWeekday]       = useState("");
  const [weekend, setWeekend]       = useState("");
  const [pubHoliday, setPubHoliday] = useState("");
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving]  = useState(false);
  const [toast, setToast]    = useState<Toast | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data } = await createClient()
        .from("pay_rates")
        .select("base_rate, saturday_rate, public_holiday_rate")
        .eq("vendor_id", user!.id)
        .maybeSingle();
      if (data) {
        if (data.base_rate           != null) setWeekday(String(data.base_rate));
        if (data.saturday_rate       != null) setWeekend(String(data.saturday_rate));
        if (data.public_holiday_rate != null) setPubHoliday(String(data.public_holiday_rate));
      }
      setDataLoading(false);
    }
    load();
  }, [user?.id]);

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

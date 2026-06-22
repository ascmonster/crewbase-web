"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

const TIMEZONES = [
  "Australia/Melbourne",
  "Australia/Sydney",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Pacific/Auckland",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
];

export default function NewEventPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [timezone, setTimezone] = useState("Australia/Melbourne");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [paymentMode, setPaymentMode] = useState<"square_terminal" | "square_register" | "stripe_automated">("square_register");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError("Start and end dates are required.");
      return;
    }

    if (endDate < startDate) {
      setError("End date must be after start date.");
      return;
    }

    if (!user) return;
    setSubmitting(true);

    const supabase = createClient();

    const { data, error: insertError } = await supabase
      .from("events")
      .insert({
        name: name.trim(),
        location: location.trim(),
        description: description.trim() || null,
        start_date: startDate,
        end_date: endDate,
        timezone,
        promoter_id: user.id,
        status: "upcoming",
        payment_mode: paymentMode,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setError(insertError?.message ?? "Failed to create event.");
      setSubmitting(false);
      return;
    }

    router.push(`/dashboard/events/${data.id}/vendors`);
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-zinc-500 text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
        <Link href="/dashboard" className="hover:text-zinc-300 transition-colors">
          Events
        </Link>
        <span>/</span>
        <span className="text-zinc-300">New Event</span>
      </div>

      <h1 className="text-xl font-bold text-white mb-8">Create Event</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Event Name <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Summer Night Market"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
        </div>

        {/* Location */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Location <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Federation Square, Melbourne"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional event description…"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
          />
        </div>

        {/* Timezone */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-[#141414] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Start Date <span className="text-rose-400">*</span>
            </label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors [color-scheme:dark]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              End Date <span className="text-rose-400">*</span>
            </label>
            <input
              type="date"
              required
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors [color-scheme:dark]"
            />
          </div>
        </div>

        {/* Payment Mode */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Payment Mode <span className="text-rose-400">*</span>
          </label>
          <div className="flex flex-col gap-2">
            {/* Square Terminal */}
            <button
              type="button"
              onClick={() => setPaymentMode("square_terminal")}
              className={`relative rounded-xl border px-4 py-3.5 text-left transition-colors ${
                paymentMode === "square_terminal"
                  ? "border-amber-500/60 bg-amber-500/[0.08] ring-1 ring-amber-500/30"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5">💳</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">Square Terminal</span>
                    <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-400 uppercase tracking-wide">
                      Recommended
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                    Fully automated splits. Crewbase provides Square Terminal hardware. Vendor uses Crewbase app as POS.
                  </p>
                </div>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                  paymentMode === "square_terminal" ? "border-amber-500" : "border-zinc-600"
                }`}>
                  {paymentMode === "square_terminal" && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                </div>
              </div>
            </button>

            {/* Square Register */}
            <button
              type="button"
              onClick={() => setPaymentMode("square_register")}
              className={`relative rounded-xl border px-4 py-3.5 text-left transition-colors ${
                paymentMode === "square_register"
                  ? "border-amber-500/60 bg-amber-500/[0.08] ring-1 ring-amber-500/30"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5">🖥️</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">Square Register</span>
                    <span className="rounded-full bg-zinc-500/20 border border-zinc-500/30 px-2 py-0.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
                      Most Compatible
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                    Vendors keep their existing Square setup. Crewbase reads transactions and shows split breakdown. Manual settlement.
                  </p>
                </div>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                  paymentMode === "square_register" ? "border-amber-500" : "border-zinc-600"
                }`}>
                  {paymentMode === "square_register" && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                </div>
              </div>
            </button>

            {/* Stripe Automated — disabled */}
            <div className="relative rounded-xl border border-white/[0.05] bg-white/[0.01] px-4 py-3.5 opacity-50 cursor-not-allowed">
              <div className="flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5">🏦</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-zinc-300">Stripe Automated</span>
                    <span className="rounded-full bg-zinc-700/50 border border-zinc-600/30 px-2 py-0.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wide">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                    Vendors keep existing setup. Automated bank transfers via Stripe after event ends.
                  </p>
                </div>
                <div className="mt-0.5 w-4 h-4 rounded-full border-2 border-zinc-700 shrink-0" />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <Link
            href="/dashboard"
            className="flex-1 flex h-10 items-center justify-center rounded-lg border border-white/[0.08] text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 flex h-10 items-center justify-center rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating…" : "Create Event →"}
          </button>
        </div>
      </form>
    </div>
  );
}

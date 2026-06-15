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

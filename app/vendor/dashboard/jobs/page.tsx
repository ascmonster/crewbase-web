"use client";

import { useEffect, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────
// Backed by the `job_posts` table (vendor-owned via vendor_id = auth user id).
// job_applications links to job_posts via job_id. The JobRow field names below
// are kept (body/date/hourly_rate/spots_available); the DB columns are
// description/start_date/pay_rate/positions_available, aliased in JOB_SELECT.

type JobRow = {
  id: string;
  title: string;
  body: string | null;
  location: string | null;
  event_name: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  hourly_rate: number | null;
  spots_available: number | null;
  requirements: string | null;
  category: string | null;
  status: string;
  applicant_count: number;
  pending_count: number;
};

type ApplicantRow = {
  id: string;
  job_id: string;
  job_title: string;
  staff_id: string;
  full_name: string;
  email: string | null;
  created_at: string;
  status: string;
};

type Tab = "postings" | "applicants";

const JOB_SELECT = "id, title, body:description, location, date:start_date, start_time, end_time, hourly_rate:pay_rate, spots_available:positions_available, requirements, category, status";

const CATEGORY_OPTIONS = ["Bar Staff", "Food Staff", "Event Staff", "Security", "Ticketing", "Cleaning", "Other"];

// requirements is stored as a stringified JSON array of keys
const REQ_OPTIONS = [
  { key: "rsa_licence", label: "RSA Licence Required" },
  { key: "food_handler", label: "Food Handler Certificate Required" },
];
const REQ_LABELS: Record<string, string> = Object.fromEntries(REQ_OPTIONS.map((r) => [r.key, r.label]));

// Parse the stored requirements value into readable pill labels. Requirements
// are stored as a JSON array; JSON.parse is guarded so legacy free-text rows
// (pre-JSON) safely fall back to an empty array (no pills) rather than throwing.
function parseRequirements(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map((x) => REQ_LABELS[String(x)] ?? String(x)).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const JOB_STATUS_CFG: Record<string, string> = {
  open:   "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  closed: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
  filled: "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20",
};

const APP_STATUS_CFG: Record<string, string> = {
  pending:  "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
  accepted: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  approved: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  rejected: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
};

function jobStatusCls(s: string) {
  return JOB_STATUS_CFG[s.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20";
}
function appStatusCls(s: string) {
  return APP_STATUS_CFG[s.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20";
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s.includes("T") ? s : s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m ?? "00"} ${period}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
    : name.charAt(0).toUpperCase();
}

// ── Atoms ──────────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-9 h-9 rounded-full bg-[#FF6B35]/15 text-[#FF6B35] flex items-center justify-center text-sm font-bold shrink-0">
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

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 animate-pulse">
          <div className="h-4 w-1/3 rounded bg-white/[0.06] mb-2" />
          <div className="h-3 w-2/3 rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}

// ── Post a Job modal ───────────────────────────────────────────────────────

function PostJobModal({ vendorId, onClose, onPosted }: {
  vendorId: string;
  onClose: () => void;
  onPosted: (job: JobRow) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [spots, setSpots] = useState("");
  const [requirements, setRequirements] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("Job title is required."); return; }
    setSaving(true);
    setErr(null);

    // Store requirements as a JSON array of the (comma-separated) strings the
    // user entered, matching the promoter format that parseRequirements reads.
    const requirementsArray = requirements.split(",").map((s) => s.trim()).filter(Boolean);

    const { data, error } = await createClient()
      .from("job_posts")
      .insert({
        vendor_id: vendorId,
        title: title.trim(),
        description: body.trim() || null,
        location: location.trim() || null,
        start_date: date || null,
        start_time: startTime || null,
        end_time: endTime || null,
        pay_rate: hourlyRate ? parseFloat(hourlyRate) : null,
        positions_available: spots ? parseInt(spots, 10) : null,
        requirements: requirementsArray.length > 0 ? JSON.stringify([...requirementsArray]) : null,
        category: category || null,
        status: "open",
      })
      .select(JOB_SELECT)
      .single();

    if (error) { setErr(error.message); setSaving(false); return; }
    onPosted({ ...(data as Omit<JobRow, "applicant_count" | "pending_count">), applicant_count: 0, pending_count: 0 });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/70">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white text-base">Post a Job</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Line Cook"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors" />
          </Field>

          <Field label="Description">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What the role involves…"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors resize-none" />
          </Field>

          <Field label="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue / area"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors" />
          </Field>

          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-[#141414] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]">
              <option value="">Select a category…</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Time">
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]" />
            </Field>
            <Field label="End Time">
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Hourly Rate">
              <input type="number" min="0" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="25.00"
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors [appearance:textfield]" />
            </Field>
            <Field label="Spots Available">
              <input type="number" min="0" step="1" value={spots} onChange={(e) => setSpots(e.target.value)} placeholder="3"
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors [appearance:textfield]" />
            </Field>
          </div>

          <Field label="Requirements">
            <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} rows={2} placeholder="e.g. RSA, food handling certificate"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors resize-none" />
          </Field>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-10 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {saving ? "Posting…" : "Post Job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorJobsPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [activeTab, setActiveTab] = useState<Tab>("postings");

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [showPost, setShowPost] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [applicants, setApplicants] = useState<ApplicantRow[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [appsLoading, setAppsLoading] = useState(false);
  const [filterJob, setFilterJob] = useState<string>("all");
  const [jobFilter, setJobFilter] = useState<"all" | "open" | "closed" | "filled">("all");
  const [busyApp, setBusyApp] = useState<string | null>(null);

  // ── Jobs load ──
  useEffect(() => {
    if (!user) return;
    async function load() {
      setJobsLoading(true);
      const supabase = createClient();
      const { data: jobRows } = await supabase
        .from("job_posts")
        .select(JOB_SELECT)
        .eq("vendor_id", user!.id)
        .order("start_date", { ascending: false });

      const rows = (jobRows ?? []) as Omit<JobRow, "applicant_count" | "pending_count">[];
      const jobIds = rows.map((r) => r.id);

      const counts: Record<string, { total: number; pending: number }> = {};
      if (jobIds.length > 0) {
        const { data: apps } = await supabase
          .from("job_applications")
          .select("job_id, status")
          .in("job_id", jobIds);
        for (const a of (apps ?? []) as { job_id: string; status: string }[]) {
          const c = (counts[a.job_id] ??= { total: 0, pending: 0 });
          c.total += 1;
          if (a.status?.toLowerCase() === "pending") c.pending += 1;
        }
      }

      setJobs(rows.map((r) => ({
        ...r,
        applicant_count: counts[r.id]?.total ?? 0,
        pending_count: counts[r.id]?.pending ?? 0,
      })));
      setJobsLoading(false);
    }
    load();
  }, [user?.id]);

  // ── Applicants lazy load ──
  useEffect(() => {
    if (activeTab !== "applicants" || appsLoaded || !user || jobsLoading) return;
    async function load() {
      setAppsLoading(true);
      const supabase = createClient();
      const jobIds = jobs.map((j) => j.id);

      if (jobIds.length === 0) { setApplicants([]); setAppsLoaded(true); setAppsLoading(false); return; }

      const { data: appRows } = await supabase
        .from("job_applications")
        .select("id, job_id, staff_id, status, created_at")
        .in("job_id", jobIds)
        .order("created_at", { ascending: false });

      const rows = (appRows ?? []) as { id: string; job_id: string; staff_id: string; status: string; created_at: string }[];
      const staffIds = [...new Set(rows.map((r) => r.staff_id))];

      let userMap: Record<string, { full_name: string; email: string | null }> = {};
      if (staffIds.length > 0) {
        const { data: usersRes } = await supabase.from("users").select("id, full_name, email").in("id", staffIds);
        userMap = Object.fromEntries(
          ((usersRes ?? []) as { id: string; full_name: string; email: string | null }[]).map((u) => [u.id, { full_name: u.full_name, email: u.email }])
        );
      }
      const jobTitleMap = Object.fromEntries(jobs.map((j) => [j.id, j.title]));

      setApplicants(rows.map((r) => ({
        id: r.id,
        job_id: r.job_id,
        job_title: jobTitleMap[r.job_id] ?? "—",
        staff_id: r.staff_id,
        full_name: userMap[r.staff_id]?.full_name ?? "Unknown",
        email: userMap[r.staff_id]?.email ?? null,
        created_at: r.created_at,
        status: r.status,
      })));
      setAppsLoaded(true);
      setAppsLoading(false);
    }
    load();
  }, [activeTab, appsLoaded, user?.id, jobsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteJob(id: string) {
    await createClient().from("job_posts").delete().eq("id", id).eq("vendor_id", user!.id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setConfirmDelete(null);
  }

  async function setAppStatus(id: string, status: "approved" | "rejected") {
    setBusyApp(id);
    await createClient().from("job_applications").update({ status }).eq("id", id);
    setApplicants((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    setBusyApp(null);
  }

  function openApplicantsFor(jobId: string) {
    setFilterJob(jobId);
    setActiveTab("applicants");
  }

  const visibleApplicants = filterJob === "all" ? applicants : applicants.filter((a) => a.job_id === filterJob);

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Jobs</h1>
        {activeTab === "postings" && (
          <button
            onClick={() => setShowPost(true)}
            className="flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Post a Job
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06]">
        {([["postings", "Job Postings"], ["applicants", "Applicants"]] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === key ? "text-white border-[#FF6B35]" : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Job Postings ── */}
      {activeTab === "postings" && (
        authLoading || jobsLoading ? (
          <SkeletonRows count={3} />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>}
            title="No job postings yet"
            sub="Post a job to start receiving applicants."
          />
        ) : (() => {
          const visibleJobs = jobFilter === "all" ? jobs : jobs.filter((j) => j.status.toLowerCase() === jobFilter);
          return (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Filter:</label>
              <select
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value as typeof jobFilter)}
                className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-1.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="filled">Filled</option>
              </select>
            </div>
            {visibleJobs.length === 0 ? (
              <EmptyState
                icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>}
                title={`No ${jobFilter} jobs`}
              />
            ) : (
            <div className="flex flex-col gap-3">
            {visibleJobs.map((j) => {
              const startLabel = fmtTime(j.start_time);
              const endLabel = fmtTime(j.end_time);
              const reqPills = parseRequirements(j.requirements);
              return (
                <div key={j.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-[#FF6B35]/30 transition-colors">
                  <button onClick={() => openApplicantsFor(j.id)} className="w-full text-left px-4 py-4">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <p className="text-sm font-semibold text-white">{j.title}</p>
                        {j.category && (
                          <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">{j.category}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="rounded-full bg-[#FF6B35]/10 px-2 py-0.5 text-xs font-semibold text-[#FF6B35]">
                          {j.applicant_count} applicant{j.applicant_count !== 1 ? "s" : ""}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${jobStatusCls(j.status)}`}>
                          {j.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    {j.body && (
                      <p className="text-xs text-zinc-500 line-clamp-2 mb-2 whitespace-pre-line">{j.body}</p>
                    )}

                    {/* Shift block */}
                    {(startLabel || endLabel) && (
                      <div className="inline-flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 mb-2">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span className="text-xs font-medium text-zinc-300">{startLabel ?? "—"} → {endLabel ?? "—"}</span>
                      </div>
                    )}

                    {/* Requirement pills */}
                    {reqPills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {reqPills.map((r, i) => (
                          <span key={i} className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">{r}</span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                      <span className="flex items-center gap-1.5 text-[#FF6B35] font-medium">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                        {j.applicant_count} applicant{j.applicant_count !== 1 ? "s" : ""}
                      </span>
                      {j.pending_count > 0 && <span className="text-amber-400">{j.pending_count} pending</span>}
                      {j.date && <span>· {fmtDate(j.date)}</span>}
                      {j.hourly_rate != null && <span>· ${j.hourly_rate}/hr</span>}
                      {j.spots_available != null && <span>· {j.spots_available} spot{j.spots_available !== 1 ? "s" : ""}</span>}
                    </div>
                  </button>
                  <div className="px-4 pb-3 flex justify-end">
                    {confirmDelete === j.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">Delete this job?</span>
                        <button onClick={() => deleteJob(j.id)} className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors">Confirm</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(j.id)} className="text-xs text-zinc-600 hover:text-rose-400 transition-colors">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
            )}
          </div>
          );
        })()
      )}

      {/* ── Applicants ── */}
      {activeTab === "applicants" && (
        <div className="flex flex-col gap-4">
          {jobs.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Filter:</label>
              <select
                value={filterJob}
                onChange={(e) => setFilterJob(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-1.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]"
              >
                <option value="all">All jobs</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </div>
          )}

          {authLoading || appsLoading ? (
            <SkeletonRows count={4} />
          ) : visibleApplicants.length === 0 ? (
            <EmptyState
              icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              title="No applicants yet"
              sub="Applications to your jobs will appear here."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {visibleApplicants.map((a) => (
                <div key={a.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                  <Avatar name={a.full_name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{a.full_name}</p>
                    <p className="text-xs text-zinc-500 truncate">{a.email ?? "—"}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">{a.job_title} · Applied {fmtDate(a.created_at)}</p>
                  </div>
                  {a.status.toLowerCase() === "pending" ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setAppStatus(a.id, "approved")}
                        disabled={busyApp === a.id}
                        className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 px-3 py-1 text-xs font-semibold hover:bg-emerald-600/40 transition-colors disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => setAppStatus(a.id, "rejected")}
                        disabled={busyApp === a.id}
                        className="rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 px-3 py-1 text-xs font-semibold hover:bg-rose-600/40 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${appStatusCls(a.status)}`}>
                      {a.status.toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showPost && user && (
        <PostJobModal
          vendorId={user.id}
          onClose={() => setShowPost(false)}
          onPosted={(job) => setJobs((prev) => [job, ...prev])}
        />
      )}
    </div>
  );
}

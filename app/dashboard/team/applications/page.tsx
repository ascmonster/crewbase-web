"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type JobListing = {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  category: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  pay_rate: number | null;
  positions_available: number | null;
  positions_filled: number | null;
  requirements: string | null;
  status: string | null;
  created_at: string;
  applicant_count: number;
  pending_count: number;
};

type Applicant = {
  id: string;
  job_id: string;
  staff_id: string;
  status: string | null;
  created_at: string;
  full_name: string;
};

const CATEGORY_OPTIONS = ["Bar Staff", "Food Staff", "Event Staff", "Security", "Ticketing", "Cleaning", "Other"];

// requirements is stored as a stringified JSON array of keys
const REQ_OPTIONS = [
  { key: "rsa_licence", label: "RSA Licence Required" },
  { key: "food_handler", label: "Food Handler Certificate Required" },
];
const REQ_LABELS: Record<string, string> = Object.fromEntries(REQ_OPTIONS.map((r) => [r.key, r.label]));

// Parse stored requirements into readable pill labels (JSON array or legacy free text).
function parseRequirements(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map((x) => REQ_LABELS[String(x)] ?? String(x)).filter(Boolean);
  } catch { /* not JSON — treat as free text below */ }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Columns on job_posts (the promoter table). Note: no event_id / promoter_id.
const JOB_POST_SELECT = "id, title, location, description, category, start_date, end_date, start_time, end_time, pay_rate, positions_available, positions_filled, requirements, status, created_at";

function fmtDate(s: string | null) {
  if (!s) return null;
  // Append T00:00:00 to date-only strings so they parse in local time (avoids UTC off-by-one)
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

// ── Post Job modal ─────────────────────────────────────────────────────────

function PostJobModal({ promoterId, onPosted, onClose }: {
  promoterId: string;
  onPosted: (job: JobListing) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: "",
    location: "",
    description: "",
    category: "",
    pay_rate: "",
    positions_available: "",
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
  });
  const [reqs, setReqs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(k: string, v: string) { setForm((p) => ({ ...p, [k]: v })); }
  function toggleReq(key: string) {
    setReqs((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setErr("Title is required"); return; }
    setSaving(true);
    setErr(null);
    const { data, error } = await createClient().from("job_posts").insert({
      vendor_id: promoterId,
      title: form.title.trim(),
      location: form.location.trim() || null,
      description: form.description.trim() || null,
      category: form.category || null,
      pay_rate: form.pay_rate ? parseFloat(form.pay_rate) : null,
      positions_available: form.positions_available ? parseInt(form.positions_available) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      requirements: JSON.stringify(reqs),
      status: "open",
    }).select(JOB_POST_SELECT).single();
    if (error) { setErr(error.message); setSaving(false); return; }
    onPosted({ ...data, applicant_count: 0, pending_count: 0 } as JobListing);
    onClose();
    setSaving(false);
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
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Job Title *</label>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Bar Staff"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Location</label>
            <input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Melbourne CBD"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Category</label>
            <select value={form.category} onChange={(e) => set("category", e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-[#141414] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500 transition-colors [color-scheme:dark]">
              <option value="">Select a category…</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Description</label>
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} placeholder="Role details…"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors resize-none" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Requirements</label>
            {REQ_OPTIONS.map((r) => (
              <label key={r.key} className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={reqs.includes(r.key)} onChange={() => toggleReq(r.key)}
                  className="w-4 h-4 rounded border-white/[0.2] bg-white/[0.04] text-violet-500 focus:ring-violet-500" />
                <span className="text-sm text-zinc-300">{r.label}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Pay Rate ($/hr)</label>
              <input type="number" min="0" step="0.01" value={form.pay_rate} onChange={(e) => set("pay_rate", e.target.value)} placeholder="25.00"
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Positions</label>
              <input type="number" min="1" value={form.positions_available} onChange={(e) => set("positions_available", e.target.value)} placeholder="1"
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Start Date</label>
              <input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500 transition-colors" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">End Date</label>
              <input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500 transition-colors" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Start Time</label>
              <input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500 transition-colors [color-scheme:dark]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">End Time</label>
              <input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500 transition-colors [color-scheme:dark]" />
            </div>
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 h-10 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50">
              {saving ? "Posting…" : "Post Job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── View Applicants modal ──────────────────────────────────────────────────

function ViewApplicantsModal({ job, onClose, onCountChange }: {
  job: JobListing;
  onClose: () => void;
  onCountChange: (jobId: string, delta: number, pendingDelta: number) => void;
}) {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: appData } = await supabase
        .from("job_applications")
        .select("id, job_id, staff_id, status, created_at")
        .eq("job_id", job.id)
        .order("created_at", { ascending: true });
      const rows = (appData as Omit<Applicant, "full_name">[]) ?? [];
      if (rows.length === 0) { setApplicants([]); setLoading(false); return; }

      const staffIds = [...new Set(rows.map((r) => r.staff_id))];
      const { data: spData } = await supabase.from("staff_profiles").select("user_id, full_name").in("user_id", staffIds);
      const spMap = Object.fromEntries(((spData ?? []) as { user_id: string; full_name: string }[]).map((p) => [p.user_id, p.full_name]));
      setApplicants(rows.map((r) => ({ ...r, full_name: spMap[r.staff_id] ?? r.staff_id })));
      setLoading(false);
    }
    load();
  }, [job.id]);

  async function setStatus(appId: string, status: "approved" | "rejected") {
    setActing(appId);
    await createClient().from("job_applications").update({ status }).eq("id", appId);
    const old = applicants.find((a) => a.id === appId);
    const wasPending = !old?.status || old.status === "pending";
    setApplicants((prev) => prev.map((a) => a.id === appId ? { ...a, status } : a));
    onCountChange(job.id, 0, wasPending ? -1 : 0);
    setActing(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/70">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="font-semibold text-white text-base">{job.title}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Applicants</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-zinc-500 text-sm">Loading…</div>
          ) : applicants.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-sm">No applicants yet</div>
          ) : (
            <div className="flex flex-col gap-2">
              {applicants.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-xs font-bold shrink-0">
                    {a.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{a.full_name}</p>
                    <p className="text-xs text-zinc-600">{fmtDate(a.created_at)}</p>
                  </div>
                  {a.status === "approved" ? (
                    <span className="rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 px-2 py-0.5 text-xs font-semibold">Approved</span>
                  ) : a.status === "rejected" ? (
                    <span className="rounded-full bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20 px-2 py-0.5 text-xs font-semibold">Rejected</span>
                  ) : (
                    <div className="flex gap-1.5">
                      <button onClick={() => setStatus(a.id, "approved")} disabled={acting === a.id}
                        className="rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-600/30 transition-colors disabled:opacity-50">
                        Approve
                      </button>
                      <button onClick={() => setStatus(a.id, "rejected")} disabled={acting === a.id}
                        className="rounded-lg bg-rose-600/20 text-rose-400 border border-rose-500/20 px-2.5 py-1 text-xs font-semibold hover:bg-rose-600/30 transition-colors disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ApplicationsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showPostJob, setShowPostJob] = useState(false);
  const [viewJob, setViewJob] = useState<JobListing | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();

      const { data: jobData } = await supabase
        .from("job_posts")
        .select(JOB_POST_SELECT)
        .eq("vendor_id", user!.id)
        .order("created_at", { ascending: false });

      const rows = (jobData as Omit<JobListing, "applicant_count" | "pending_count">[]) ?? [];
      if (rows.length > 0) {
        const jobIds = rows.map((j) => j.id);
        const { data: appData } = await supabase.from("job_applications").select("job_id, status").in("job_id", jobIds);
        const apps = (appData ?? []) as { job_id: string; status: string | null }[];
        const counts: Record<string, number> = {};
        const pending: Record<string, number> = {};
        for (const a of apps) {
          counts[a.job_id] = (counts[a.job_id] ?? 0) + 1;
          if (!a.status || a.status === "pending") pending[a.job_id] = (pending[a.job_id] ?? 0) + 1;
        }
        setJobs(rows.map((j) => ({ ...j, applicant_count: counts[j.id] ?? 0, pending_count: pending[j.id] ?? 0 })));
      } else {
        setJobs([]);
      }

      setDataLoading(false);
    }
    load();
  }, [user?.id]);

  async function closeJob(id: string) {
    setClosing(id);
    await createClient().from("job_posts").update({ status: "closed" }).eq("id", id);
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: "closed" } : j));
    setClosing(null);
  }

  function handleCountChange(jobId: string, delta: number, pendingDelta: number) {
    setJobs((prev) => prev.map((j) =>
      j.id === jobId
        ? { ...j, applicant_count: j.applicant_count + delta, pending_count: j.pending_count + pendingDelta }
        : j
    ));
  }

  if (authLoading || dataLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  return (
    <>
      {showPostJob && user && (
        <PostJobModal
          promoterId={user.id}
          onPosted={(job) => setJobs((prev) => [job, ...prev])}
          onClose={() => setShowPostJob(false)}
        />
      )}
      {viewJob && (
        <ViewApplicantsModal
          job={viewJob}
          onClose={() => setViewJob(null)}
          onCountChange={handleCountChange}
        />
      )}

      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/team" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <h1 className="text-xl font-bold flex-1">Applications</h1>
          <button onClick={() => setShowPostJob(true)}
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors">
            + Post Job
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center text-zinc-600">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="font-semibold text-zinc-300 mb-1">No job listings yet</p>
              <p className="text-sm text-zinc-600">Post a job to start receiving applications from staff</p>
            </div>
            <button onClick={() => setShowPostJob(true)}
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors">
              Post a Job
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {jobs.map((j) => (
              <div key={j.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white text-sm">{j.title}</p>
                      {j.category && (
                        <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">{j.category}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                      {j.location && <span className="text-xs text-zinc-500">{j.location}</span>}
                      {j.start_date && <span className="text-xs text-zinc-600">· {fmtDate(j.start_date)}</span>}
                      {j.pay_rate != null && <span className="text-xs text-zinc-600">· ${j.pay_rate}/hr</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {j.status && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        j.status === "open"
                          ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                          : j.status === "closed"
                          ? "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20"
                          : "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20"
                      }`}>
                        {j.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Shift block */}
                {(fmtTime(j.start_time) || fmtTime(j.end_time)) && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 mb-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span className="text-xs font-medium text-zinc-300">{fmtTime(j.start_time) ?? "—"} → {fmtTime(j.end_time) ?? "—"}</span>
                  </div>
                )}

                {/* Requirement pills */}
                {parseRequirements(j.requirements).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {parseRequirements(j.requirements).map((r, i) => (
                      <span key={i} className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">{r}</span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.04]">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setViewJob(j)} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors font-medium">
                      <span className="font-semibold text-white">{j.applicant_count}</span> applicant{j.applicant_count !== 1 ? "s" : ""}
                      {j.pending_count > 0 && (
                        <span className="rounded-full bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold leading-none">
                          {j.pending_count} pending
                        </span>
                      )}
                    </button>
                    {j.positions_available != null && (
                      <span className="text-xs text-zinc-500">
                        <span className="font-semibold text-white">{j.positions_filled ?? 0}/{j.positions_available}</span> filled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-600">Posted {fmtDate(j.created_at)}</span>
                    {j.status === "open" && (
                      <button
                        onClick={() => closeJob(j.id)}
                        disabled={closing === j.id}
                        className="rounded-lg border border-white/[0.08] text-zinc-500 hover:text-white px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40">
                        {closing === j.id ? "Closing…" : "Close"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

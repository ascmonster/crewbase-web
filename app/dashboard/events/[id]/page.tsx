"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { deriveDisplayStatus } from "@/lib/eventStatus";

// ── Types ──────────────────────────────────────────────────────────────────

type EventRow = {
  id: string;
  name: string;
  location: string;
  start_date: string;
  end_date: string;
  timezone: string;
  status: string;
  description: string | null;
  promoter_id: string;
};

type VendorProfile = {
  id: string;      // vendor_profiles PK — used for doc requests
  user_id: string; // auth uid = event_vendors.vendor_id
  business_name: string;
  username: string | null;
};

type EventVendorRow = {
  vendor_id: string; // = vendor_profiles.user_id = auth uid
  status: string;
  staff_limit: number | null;
  category: string | null;
  profile: VendorProfile | null;
};

type EventStaffRow = {
  staff_id: string;
  status: string;
  is_gate_staff: boolean;
  vendor_id: string | null;
};

type StaffProfile = {
  id?: string; // staff_profiles PK — not the auth uid
  user_id: string; // auth uid = event_staff.staff_id
  full_name: string;
};

type CheckinRow = {
  user_id: string;
  checked_in_at: string | null;
  status: string;
};

type DocRow = {
  id: string;
  title: string;
  type: string | null;
  content: string | null;
  file_url: string | null;
  created_at: string;
};

type BroadcastRow = {
  id: string;
  message: string;
  recipient_type: string;
  created_at: string;
};

// vendor_id here = vendor_profiles.id (PK), NOT auth uid
type DocRequestRow = {
  id: string;
  vendor_id: string;
  status: string;
};

type VendorStaffCount = {
  vendor_id: string;
  staff_count: number;
};

type VendorTruck = {
  id: string;
  name: string;
  vendor_id: string;
};

type DateChangeRequest = {
  id: string;
  status: string;
  new_start_time: string;
  new_end_time: string;
};

type StaffApprovalRow = {
  staff_id: string;
  status: string;
  approved_at: string | null;
};

type StaffDocAck = {
  document_id: string;
  staff_id: string;
};

type VendorDocAck = {
  vendor_id: string;
  document_id: string;
};

type VendorApprovalRow = {
  vendor_id: string;
  status: string;
};

type StaffRating = {
  user_id: string;
  avg_rating: number | null;
};

type Tab = "vendors" | "staff" | "checkins" | "gatestaff" | "docs" | "broadcast" | "revenue" | "splits";

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active:             "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  confirmed:          "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  approved:           "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  pending:            "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
  invited:            "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
  paid:               "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20",
  cancelled:          "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
  completed:          "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
  submitted:          "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20",
  changes_requested:  "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
  rejected:           "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
};

function Badge({ status, label }: { status: string; label?: string }) {
  const cls = STATUS_STYLES[status.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label ?? status.toUpperCase()}
    </span>
  );
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(s: string | null) {
  if (!s) return "";
  const diff = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return fmtDateTime(s);
}

function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length >= 2
      ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
      : name.charAt(0).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-sm font-bold shrink-0">
      {initials}
    </div>
  );
}

function DashedBtn({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-dashed border-white/[0.15] py-3 text-sm font-medium text-zinc-400 hover:border-white/30 hover:text-white transition-colors"
    >
      {label}
    </button>
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

// ── Modal: Date Edit ───────────────────────────────────────────────────────

function DateEditModal({
  event,
  vendorCount,
  userId,
  onClose,
  onUpdated,
}: {
  event: EventRow;
  vendorCount: number;
  userId: string;
  onClose: () => void;
  onUpdated: (start: string, end: string) => void;
}) {
  const [start, setStart] = useState(event.start_date);
  const [end, setEnd] = useState(event.end_date);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!start || !end || end < start) { setErr("End date must be after start date."); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();

    if (vendorCount === 0) {
      const { error } = await supabase
        .from("events")
        .update({ start_date: start, end_date: end })
        .eq("id", event.id);
      if (error) { setErr(error.message); setSaving(false); return; }
      onUpdated(start, end);
      onClose();
      return;
    }

    // Check for existing pending request
    const { data: existing } = await supabase
      .from("event_date_change_requests")
      .select("id")
      .eq("event_id", event.id)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      setErr("A date change request is already pending.");
      setSaving(false);
      return;
    }

    // Fetch vendor ids for approvals
    const { data: vendorRows } = await supabase
      .from("event_vendors")
      .select("vendor_id")
      .eq("event_id", event.id);

    const { data: req, error: reqErr } = await supabase
      .from("event_date_change_requests")
      .insert({ event_id: event.id, new_start_time: start, new_end_time: end, status: "pending" })
      .select("id")
      .single();

    if (reqErr || !req) { setErr(reqErr?.message ?? "Failed to create request."); setSaving(false); return; }

    const approvals = (vendorRows ?? []).map((v: { vendor_id: string }) => ({
      request_id: req.id,
      vendor_id: v.vendor_id,
    }));
    if (approvals.length > 0) {
      await supabase.from("event_date_change_approvals").insert(approvals);
    }

    await supabase.from("event_broadcasts").insert({
      event_id: event.id,
      promoter_id: userId,
      message: `Date change requested: ${start} → ${end}`,
      recipient_type: "vendors",
    });

    setMsg("Sent for Approval");
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Edit Dates</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {msg ? (
          <div className="text-center py-6">
            <p className="text-emerald-400 font-medium mb-4">{msg}</p>
            <button onClick={onClose} className="rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Close</button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 mb-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Start Date</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500 [color-scheme:dark]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">End Date</label>
                <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500 [color-scheme:dark]" />
              </div>
            </div>
            {vendorCount > 0 && (
              <p className="text-xs text-amber-400 mb-4">This event has vendors — a date change request will be sent for their approval.</p>
            )}
            {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 h-9 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal: Request Docs from All Vendors ───────────────────────────────────

const DOC_TYPE_OPTIONS = [
  "Public Liability Insurance",
  "Food Safety Certificate",
  "Business Registration",
  "Working With Children Check",
  "Other Documentation",
];

function RequestDocsModal({
  eventId,
  userId,
  vendorRows,
  existingRequests,
  onClose,
  onSubmitted,
}: {
  eventId: string;
  userId: string;
  vendorRows: EventVendorRow[];
  existingRequests: DocRequestRow[];
  onClose: () => void;
  onSubmitted: (newRequests: DocRequestRow[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customDoc, setCustomDoc] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(opt: string) {
    setSelected((p) => p.includes(opt) ? p.filter((x) => x !== opt) : [...p, opt]);
  }

  async function submit() {
    const docTypes = [...selected, ...(customDoc.trim() ? [customDoc.trim()] : [])];
    if (docTypes.length === 0) { setErr("Select at least one document type."); return; }
    setSending(true);
    setErr(null);

    const existingVpIds = new Set(existingRequests.map((r) => r.vendor_id));
    // Only vendors without an existing request
    const toInsert = vendorRows
      .filter((v) => v.profile && !existingVpIds.has(v.profile.id))
      .map((v) => ({
        event_id: eventId,
        vendor_id: v.profile!.id, // vendor_profiles.id (PK)
        promoter_id: userId,
        doc_types: docTypes,
        message: message.trim() || null,
        status: "pending",
      }));

    if (toInsert.length === 0) {
      setErr("All vendors already have a doc request.");
      setSending(false);
      return;
    }

    const { data, error } = await createClient()
      .from("event_document_requests")
      .insert(toInsert)
      .select("id, vendor_id, status");

    if (error) { setErr(error.message); setSending(false); return; }
    onSubmitted((data as DocRequestRow[]) ?? []);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Request Documents</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-2 mb-4">
          {DOC_TYPE_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="w-4 h-4 rounded border-white/[0.2] bg-white/[0.04] text-indigo-500 focus:ring-indigo-500"
              />
              <span className="text-sm text-zinc-300">{opt}</span>
            </label>
          ))}
          <input
            type="text"
            value={customDoc}
            onChange={(e) => setCustomDoc(e.target.value)}
            placeholder="Custom document type…"
            className="mt-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5 mb-4">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Message (optional)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Add a note for vendors…"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors resize-none"
          />
        </div>

        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={sending} className="flex-1 h-9 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {sending ? "Sending…" : "Send Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Add Document ────────────────────────────────────────────────────

function AddDocModal({
  eventId,
  userId,
  onClose,
  onAdded,
}: {
  eventId: string;
  userId: string;
  onClose: () => void;
  onAdded: (doc: DocRow) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"text" | "pdf">("text");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setErr("Title is required."); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();

    let fileUrl: string | null = null;
    if (type === "pdf" && file) {
      const path = `${eventId}/${Date.now()}.pdf`;
      const { error: uploadErr } = await supabase.storage.from("event-documents").upload(path, file, { contentType: "application/pdf" });
      if (uploadErr) { setErr(uploadErr.message); setSaving(false); return; }
      const { data: urlData } = supabase.storage.from("event-documents").getPublicUrl(path);
      fileUrl = urlData.publicUrl;
    }

    const { data, error } = await supabase
      .from("event_documents")
      .insert({
        event_id: eventId,
        title: title.trim(),
        type,
        content: type === "text" ? content.trim() || null : null,
        file_url: fileUrl,
        created_by: userId,
      })
      .select("id, title, type, content, file_url, created_at")
      .single();

    if (error) { setErr(error.message); setSaving(false); return; }
    onAdded(data as DocRow);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Add Document</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 mb-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event Safety Brief"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
          </div>

          <div className="flex gap-2">
            {(["text", "pdf"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${type === t ? "bg-indigo-600 text-white" : "border border-white/[0.08] text-zinc-400 hover:text-white"}`}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {type === "text" ? (
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Document content…"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors resize-none" />
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">PDF File</label>
              <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-white/[0.06] file:text-white file:text-xs file:font-medium hover:file:bg-white/[0.1] transition-colors" />
            </div>
          )}
        </div>

        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 h-9 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Add Gate Staff ──────────────────────────────────────────────────

type StaffSearchResult = {
  id: string;
  user_id: string;
  full_name: string;
  username: string | null;
  avg_rating: number | null;
};

function AddGateStaffModal({
  eventId,
  existingStaffIds,
  onClose,
  onAdded,
}: {
  eventId: string;
  existingStaffIds: Set<string>;
  onClose: () => void;
  onAdded: (row: EventStaffRow, profile: StaffProfile) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StaffSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    const supabase = createClient();
    const q = query.trim();

    const { data: profiles } = await supabase
      .from("staff_profiles")
      .select("id, user_id, full_name, username")
      .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(10);

    const rows = (profiles ?? []) as { id: string; user_id: string; full_name: string; username: string | null }[];
    if (rows.length === 0) { setResults([]); setSearching(false); return; }

    const ids = rows.map((r) => r.id);
    const { data: ratings } = await supabase
      .from("user_ratings_summary")
      .select("user_id, avg_rating")
      .in("user_id", ids);

    const ratingMap = Object.fromEntries(
      ((ratings ?? []) as StaffRating[]).map((r) => [r.user_id, r.avg_rating])
    );

    setResults(rows.map((r) => ({ ...r, avg_rating: ratingMap[r.id] ?? null })));
    setSearching(false);
  }

  async function add(result: StaffSearchResult) {
    setAdding(result.id);
    const { data, error } = await createClient()
      .from("event_staff")
      .insert({ event_id: eventId, staff_id: result.id, is_gate_staff: true, status: "confirmed" })
      .select("staff_id, status, is_gate_staff, vendor_id")
      .single();

    if (!error && data) {
      onAdded(
        data as EventStaffRow,
        { id: result.id, user_id: result.user_id, full_name: result.full_name }
      );
      setResults((r) => r.filter((x) => x.id !== result.id));
    }
    setAdding(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Add Gate Staff</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search by name or username…"
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
          <button onClick={search} disabled={searching} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {searching ? "…" : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {results.map((r) => {
              const alreadyAssigned = existingStaffIds.has(r.id);
              return (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-white">{r.full_name}</p>
                    <p className="text-xs text-zinc-500">
                      {r.username ? `@${r.username}` : ""}
                      {r.avg_rating != null ? ` · ★ ${r.avg_rating.toFixed(1)}` : ""}
                    </p>
                    {alreadyAssigned && <p className="text-xs text-amber-400 mt-0.5">Already assigned as vendor staff</p>}
                  </div>
                  {!alreadyAssigned && (
                    <button onClick={() => add(r)} disabled={adding === r.id}
                      className="rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 px-3 py-1 text-xs font-semibold hover:bg-indigo-600/40 transition-colors disabled:opacity-50">
                      {adding === r.id ? "…" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modal: Add Truck ───────────────────────────────────────────────────────

function AddTruckModal({
  eventId,
  vendorId,
  onClose,
  onAdded,
}: {
  eventId: string;
  vendorId: string;
  onClose: () => void;
  onAdded: (truck: VendorTruck) => void;
}) {
  const [name, setName] = useState("");
  const [squareLocationId, setSquareLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setErr("Truck name is required."); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();

    const { data: truck, error: tErr } = await supabase
      .from("vendor_trucks")
      .insert({ vendor_id: vendorId, name: name.trim(), square_location_id: squareLocationId.trim() || null })
      .select("id, name, vendor_id")
      .single();

    if (tErr || !truck) { setErr(tErr?.message ?? "Failed to add truck."); setSaving(false); return; }

    await supabase.from("event_trucks").insert({ event_id: eventId, truck_id: (truck as VendorTruck).id });
    onAdded(truck as VendorTruck);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Add Truck</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex flex-col gap-4 mb-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Truck Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Taco Truck"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Square Location ID (optional)</label>
            <input type="text" value={squareLocationId} onChange={(e) => setSquareLocationId(e.target.value)} placeholder="LID-XXXXX"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
          </div>
        </div>
        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 h-9 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Vendors ───────────────────────────────────────────────────────────

function VendorsTab({
  vendorRows,
  setVendorRows,
  docRequests,
  setDocRequests,
  staffCounts,
  trucks,
  setTrucks,
  eventId,
  userId,
}: {
  vendorRows: EventVendorRow[];
  setVendorRows: (v: EventVendorRow[]) => void;
  docRequests: DocRequestRow[];
  setDocRequests: (r: DocRequestRow[]) => void;
  staffCounts: Record<string, number>;
  trucks: VendorTruck[];
  setTrucks: (t: VendorTruck[]) => void;
  eventId: string;
  userId: string;
}) {
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [limitValue, setLimitValue] = useState("");
  const [showRequestDocs, setShowRequestDocs] = useState(false);
  const [addTruckFor, setAddTruckFor] = useState<string | null>(null);
  const [assignCategoryFor, setAssignCategoryFor] = useState<string | null>(null);
  const [assignCategory, setAssignCategory] = useState("Food & Beverage");
  const [assigningCategory, setAssigningCategory] = useState(false);

  async function removeVendor(vendorId: string) {
    await createClient()
      .from("event_vendors")
      .delete()
      .eq("event_id", eventId)
      .eq("vendor_id", vendorId);
    setVendorRows(vendorRows.filter((v) => v.vendor_id !== vendorId));
  }

  async function saveLimit(vendorId: string) {
    const limit = parseInt(limitValue, 10);
    if (isNaN(limit)) { setEditingLimit(null); return; }
    await createClient()
      .from("event_vendors")
      .update({ staff_limit: limit })
      .eq("event_id", eventId)
      .eq("vendor_id", vendorId);
    setVendorRows(vendorRows.map((v) => v.vendor_id === vendorId ? { ...v, staff_limit: limit } : v));
    setEditingLimit(null);
  }

  async function saveCategory(vendorId: string) {
    setAssigningCategory(true);
    const { error } = await createClient()
      .from("event_vendors")
      .update({ category: assignCategory })
      .eq("event_id", eventId)
      .eq("vendor_id", vendorId);
    if (!error) {
      setVendorRows(vendorRows.map((v) => v.vendor_id === vendorId ? { ...v, category: assignCategory } : v));
      setAssignCategoryFor(null);
    }
    setAssigningCategory(false);
  }

  // Map vendor_profiles.id → docRequest
  const docReqMap = Object.fromEntries(docRequests.map((r) => [r.vendor_id, r]));
  // Map vendor_profiles.user_id → vendor_profiles.id
  const userIdToVpId = Object.fromEntries(
    vendorRows.filter((v) => v.profile).map((v) => [v.vendor_id, v.profile!.id])
  );

  function docReqForVendor(vendorId: string): DocRequestRow | undefined {
    const vpId = userIdToVpId[vendorId];
    return vpId ? docReqMap[vpId] : undefined;
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setShowRequestDocs(true)}
          className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          Request Docs from All Vendors
        </button>
      </div>
      <div className="flex gap-2 mb-4">
        <DashedBtn label="+ Invite Vendors" onClick={() => window.location.assign(`/dashboard/events/${eventId}/vendors`)} />
        <DashedBtn label="Site Map" onClick={() => window.location.assign(`/dashboard/events/${eventId}/sitemap`)} />
      </div>

      {vendorRows.length === 0 ? (
        <EmptyState
          icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>}
          title="No vendors yet"
          sub="Invite vendors to this event"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {vendorRows.map((v) => {
            const name = v.profile?.business_name ?? "Unknown Vendor";
            const count = staffCounts[v.vendor_id] ?? 0;
            const atLimit = v.staff_limit != null && count >= v.staff_limit;
            const docReq = docReqForVendor(v.vendor_id);
            const vendorTrucks = trucks.filter((t) => t.vendor_id === v.vendor_id);

            return (
              <div key={v.vendor_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white text-sm">{name}</span>
                      {v.category ? (
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-400">{v.category}</span>
                      ) : (
                        <button
                          onClick={() => { setAssignCategoryFor(v.vendor_id); setAssignCategory("Food & Beverage"); }}
                          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          Assign Category
                        </button>
                      )}
                    </div>

                    {editingLimit === v.vendor_id ? (
                      <div className="flex items-center gap-2">
                        <input type="number" value={limitValue}
                          onChange={(e) => setLimitValue(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveLimit(v.vendor_id)}
                          className="w-16 rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
                          autoFocus />
                        <button onClick={() => saveLimit(v.vendor_id)} className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Save</button>
                        <button onClick={() => setEditingLimit(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingLimit(v.vendor_id); setLimitValue(String(v.staff_limit ?? "")); }}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors text-left"
                      >
                        {v.staff_limit != null ? `${v.staff_limit} staff limit` : "No staff limit"} (edit)
                      </button>
                    )}

                    <span className={`text-xs font-medium ${atLimit ? "text-red-400" : "text-zinc-500"}`}>
                      {count}{v.staff_limit != null ? ` / ${v.staff_limit}` : ""} staff
                    </span>

                    {vendorTrucks.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {vendorTrucks.map((t) => (
                          <span key={t.id} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-400">
                            {t.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge status={v.status} />
                    <button onClick={() => removeVendor(v.vendor_id)} className="text-zinc-600 hover:text-rose-400 transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  {!docReq && (
                    <button className="rounded-full border border-indigo-500/30 px-3 py-1 text-xs font-medium text-indigo-400 hover:bg-indigo-500/10 transition-colors">
                      Request Docs
                    </button>
                  )}
                  {docReq?.status === "pending" && (
                    <span className="text-xs font-medium text-indigo-400">⏳ Docs Pending</span>
                  )}
                  {docReq?.status === "submitted" && (
                    <button className="text-xs font-medium text-indigo-400 hover:underline">📋 Review Docs</button>
                  )}
                  {docReq?.status === "approved" && (
                    <span className="text-xs font-medium text-emerald-400">✓ Docs Approved</span>
                  )}
                  {docReq?.status === "changes_requested" && (
                    <span className="text-xs font-medium text-rose-400">⚠ Changes Needed</span>
                  )}

                  <button
                    onClick={() => setAddTruckFor(v.vendor_id)}
                    className="rounded-full border border-white/[0.08] px-3 py-1 text-xs font-medium text-zinc-400 hover:text-white hover:border-white/20 transition-colors"
                  >
                    + Truck
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showRequestDocs && (
        <RequestDocsModal
          eventId={eventId}
          userId={userId}
          vendorRows={vendorRows}
          existingRequests={docRequests}
          onClose={() => setShowRequestDocs(false)}
          onSubmitted={(newReqs) => setDocRequests([...docRequests, ...newReqs])}
        />
      )}

      {addTruckFor && (
        <AddTruckModal
          eventId={eventId}
          vendorId={addTruckFor}
          onClose={() => setAddTruckFor(null)}
          onAdded={(t) => { setTrucks([...trucks, t]); setAddTruckFor(null); }}
        />
      )}

      {assignCategoryFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
          <div className="w-full max-w-xs rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
            <h3 className="font-semibold text-white mb-4">
              {vendorRows.find((v) => v.vendor_id === assignCategoryFor)?.profile?.business_name ?? "Vendor"}
            </h3>
            <div className="flex flex-col gap-1.5 mb-5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Category</label>
              <select
                value={assignCategory}
                onChange={(e) => setAssignCategory(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]"
              >
                <option value="Food & Beverage">Food &amp; Beverage</option>
                <option value="Bar">Bar</option>
                <option value="Merchandise">Merchandise</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setAssignCategoryFor(null)}
                className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => saveCategory(assignCategoryFor)}
                disabled={assigningCategory}
                className="flex-1 h-9 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
              >
                {assigningCategory ? "Saving…" : "Save Category"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Staff ─────────────────────────────────────────────────────────────

function StaffTab({
  staffRows,
  staffProfiles,
  staffVendorMap,
  vendorRows,
  eventId,
  onToggleGate,
}: {
  staffRows: EventStaffRow[];
  staffProfiles: Record<string, StaffProfile>;
  staffVendorMap: Record<string, string>;
  vendorRows: EventVendorRow[];
  eventId: string;
  onToggleGate: (staffId: string, val: boolean) => void;
}) {
  const vendorMap = Object.fromEntries(
    vendorRows.filter((v) => v.profile).map((v) => [v.vendor_id, v.profile!.business_name])
  );

  async function toggleGate(staffId: string, current: boolean) {
    await createClient()
      .from("event_staff")
      .update({ is_gate_staff: !current })
      .eq("event_id", eventId)
      .eq("staff_id", staffId);
    onToggleGate(staffId, !current);
  }

  const regularStaff = staffRows.filter((s) => !s.is_gate_staff);

  return regularStaff.length === 0 ? (
    <EmptyState
      icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
      title="No staff assigned"
      sub="Vendors bring staff to this event"
    />
  ) : (
    <div className="flex flex-col gap-3">
      {regularStaff.map((s) => {
        const profile = staffProfiles[s.staff_id];
        const name = profile?.full_name ?? "Unknown";
        const assignedVendorId = staffVendorMap[s.staff_id] ?? s.vendor_id;
        const vendorName = assignedVendorId ? vendorMap[assignedVendorId] : null;
        return (
          <div key={s.staff_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
            <Avatar name={name} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm">{name}</p>
              {vendorName && <p className="text-xs text-zinc-500 mt-0.5">via {vendorName}</p>}
            </div>
            <button
              onClick={() => toggleGate(s.staff_id, s.is_gate_staff)}
              title={s.is_gate_staff ? "Remove from gate staff" : "Make gate staff"}
              className={`transition-colors ${s.is_gate_staff ? "text-indigo-400" : "text-zinc-600 hover:text-zinc-400"}`}
            >
              <Shield
                size={16}
                fill={s.is_gate_staff ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={1.5}
              />
            </button>
            <Badge status={s.status} />
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Check-ins ─────────────────────────────────────────────────────────

function CheckInsTab({ checkins, userNames }: { checkins: CheckinRow[]; userNames: Record<string, string> }) {
  return checkins.length === 0 ? (
    <EmptyState
      icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
      title="No check-ins yet"
      sub="Scan QR codes to check people in"
    />
  ) : (
    <div className="flex flex-col gap-3">
      {checkins.map((c) => {
        const name = userNames[c.user_id] ?? c.user_id;
        return (
          <div key={c.user_id + (c.checked_in_at ?? "")} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
            <Avatar name={name} />
            <div className="flex-1">
              <p className="font-semibold text-white text-sm">{name}</p>
              {c.checked_in_at && <p className="text-xs text-zinc-500 mt-0.5">{timeAgo(c.checked_in_at)}</p>}
            </div>
            <span className="text-xs font-semibold text-emerald-400">✓ CHECKED IN</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Gate Staff ────────────────────────────────────────────────────────

function GateStaffTab({
  staffRows,
  staffProfiles,
  eventId,
  onAdd,
  onRemove,
}: {
  staffRows: EventStaffRow[];
  staffProfiles: Record<string, StaffProfile>;
  eventId: string;
  onAdd: (row: EventStaffRow, profile: StaffProfile) => void;
  onRemove: (staffId: string) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const gateStaff = staffRows.filter((s) => s.is_gate_staff);
  const allStaffIds = new Set(staffRows.map((s) => s.staff_id));

  async function remove(staffId: string) {
    await createClient()
      .from("event_staff")
      .delete()
      .eq("event_id", eventId)
      .eq("staff_id", staffId)
      .eq("is_gate_staff", true);
    onRemove(staffId);
  }

  return (
    <div className="flex flex-col gap-4">
      <DashedBtn label="+ Add Gate Staff" onClick={() => setShowModal(true)} />

      {gateStaff.length === 0 ? (
        <EmptyState
          icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
          title="No gate staff assigned"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {gateStaff.map((s) => {
            const profile = staffProfiles[s.staff_id];
            const name = profile?.full_name ?? s.staff_id;
            return (
              <div key={s.staff_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                <Avatar name={name} />
                <div className="flex-1">
                  <p className="font-semibold text-white text-sm">{name}</p>
                </div>
                <Badge status={s.status} />
                <button onClick={() => remove(s.staff_id)} className="text-zinc-600 hover:text-rose-400 transition-colors shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <AddGateStaffModal
          eventId={eventId}
          existingStaffIds={allStaffIds}
          onClose={() => setShowModal(false)}
          onAdded={(row, profile) => { onAdd(row, profile); setShowModal(false); }}
        />
      )}
    </div>
  );
}

// ── Tab: Docs ──────────────────────────────────────────────────────────────

function DocsTab({
  docs,
  setDocs,
  eventId,
  userId,
  staffRows,
  staffProfiles,
  vendorRows,
}: {
  docs: DocRow[];
  setDocs: (d: DocRow[]) => void;
  eventId: string;
  userId: string;
  staffRows: EventStaffRow[];
  staffProfiles: Record<string, StaffProfile>;
  vendorRows: EventVendorRow[];
}) {
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [staffApprovals, setStaffApprovals] = useState<StaffApprovalRow[]>([]);
  const [staffAcks, setStaffAcks] = useState<StaffDocAck[]>([]);
  const [vendorAcks, setVendorAcks] = useState<VendorDocAck[]>([]);
  const [vendorApprovals, setVendorApprovals] = useState<VendorApprovalRow[]>([]);
  const [complianceLoaded, setComplianceLoaded] = useState(false);
  const [approvingStaff, setApprovingStaff] = useState<string | null>(null);

  useEffect(() => {
    if (docs.length === 0) return;
    async function loadCompliance() {
      const supabase = createClient();
      const docIds = docs.map((d) => d.id);
      const vendorUserIds = vendorRows.map((v) => v.vendor_id);

      const [saRes, sdaRes, vdaRes, vaRes] = await Promise.all([
        supabase.from("event_staff_approval").select("staff_id, status, approved_at").eq("event_id", eventId),
        supabase.from("staff_document_acknowledgements").select("document_id, staff_id").in("document_id", docIds),
        vendorUserIds.length > 0
          ? supabase.from("vendor_document_acknowledgements").select("vendor_id, document_id").in("vendor_id", vendorUserIds).in("document_id", docIds)
          : Promise.resolve({ data: [] }),
        supabase.from("event_vendor_approval").select("vendor_id, status").eq("event_id", eventId),
      ]);

      setStaffApprovals((saRes.data as StaffApprovalRow[]) ?? []);
      setStaffAcks((sdaRes.data as StaffDocAck[]) ?? []);
      setVendorAcks((vdaRes.data as VendorDocAck[]) ?? []);
      setVendorApprovals((vaRes.data as VendorApprovalRow[]) ?? []);
      setComplianceLoaded(true);
    }
    loadCompliance();
  }, [docs, eventId, vendorRows]);

  async function approveStaff(staffId: string, status: "approved" | "rejected") {
    setApprovingStaff(staffId);
    const { data } = await createClient()
      .from("event_staff_approval")
      .upsert({ event_id: eventId, staff_id: staffId, status, approved_by: userId, approved_at: new Date().toISOString() }, { onConflict: "event_id,staff_id" })
      .select("staff_id, status, approved_at")
      .single();
    if (data) {
      setStaffApprovals((prev) => {
        const filtered = prev.filter((r) => r.staff_id !== staffId);
        return [...filtered, data as StaffApprovalRow];
      });
    }
    setApprovingStaff(null);
  }

  const regularStaff = staffRows.filter((s) => !s.is_gate_staff);
  const staffApprovalMap = Object.fromEntries(staffApprovals.map((r) => [r.staff_id, r]));
  const vendorApprovalMap = Object.fromEntries(vendorApprovals.map((r) => [r.vendor_id, r]));

  function staffAckCount(staffId: string) {
    return staffAcks.filter((a) => a.staff_id === staffId).length;
  }

  function vendorAckCount(vendorId: string) {
    return vendorAcks.filter((a) => a.vendor_id === vendorId).length;
  }

  return (
    <div>
      <div className="mb-4">
        <DashedBtn label="+ Add Document" onClick={() => setShowAddDoc(true)} />
      </div>

      {docs.length === 0 ? (
        <EmptyState
          icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
          title="No documents yet"
          sub="Add documents that staff must read and acknowledge before the event"
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 mb-8">
            {docs.map((d) => (
              <div key={d.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">{d.title}</p>
                  {d.type && <p className="text-xs text-zinc-500 mt-0.5 capitalize">{d.type}</p>}
                </div>
                {d.file_url && (
                  <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-indigo-400 hover:underline">View</a>
                )}
              </div>
            ))}
          </div>

          {complianceLoaded && (
            <>
              {/* Staff compliance */}
              {regularStaff.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Staff Compliance</h3>
                  <div className="flex flex-col gap-3">
                    {regularStaff.map((s) => {
                      const profile = staffProfiles[s.staff_id];
                      const name = profile?.full_name ?? s.staff_id;
                      const ackCount = staffAckCount(s.staff_id);
                      const allAcked = ackCount >= docs.length;
                      const approval = staffApprovalMap[s.staff_id];
                      return (
                        <div key={s.staff_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                          <Avatar name={name} />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white">{name}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{ackCount} / {docs.length} acknowledged</p>
                          </div>
                          {approval ? (
                            <Badge status={approval.status} />
                          ) : allAcked ? (
                            <div className="flex gap-2">
                              <button
                                onClick={() => approveStaff(s.staff_id, "approved")}
                                disabled={approvingStaff === s.staff_id}
                                className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 px-3 py-1 text-xs font-semibold hover:bg-emerald-600/40 transition-colors disabled:opacity-50"
                              >Approve</button>
                              <button
                                onClick={() => approveStaff(s.staff_id, "rejected")}
                                disabled={approvingStaff === s.staff_id}
                                className="rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 px-3 py-1 text-xs font-semibold hover:bg-rose-600/40 transition-colors disabled:opacity-50"
                              >Reject</button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Vendor compliance */}
              {vendorRows.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Vendor Compliance</h3>
                  <div className="flex flex-col gap-3">
                    {vendorRows.map((v) => {
                      const name = v.profile?.business_name ?? v.vendor_id;
                      const ackCount = vendorAckCount(v.vendor_id);
                      const allAcked = ackCount >= docs.length;
                      const approval = vendorApprovalMap[v.vendor_id];
                      return (
                        <div key={v.vendor_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                          <Avatar name={name} />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white">{name}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{ackCount} / {docs.length} acknowledged</p>
                          </div>
                          {approval ? <Badge status={approval.status} /> : allAcked ? (
                            <span className="text-xs text-zinc-500">Pending approval</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {showAddDoc && (
        <AddDocModal
          eventId={eventId}
          userId={userId}
          onClose={() => setShowAddDoc(false)}
          onAdded={(doc) => setDocs([...docs, doc])}
        />
      )}
    </div>
  );
}

// ── Tab: Broadcast ─────────────────────────────────────────────────────────

function BroadcastTab({
  eventId,
  userId,
  broadcasts,
  onSent,
}: {
  eventId: string;
  userId: string;
  broadcasts: BroadcastRow[];
  onSent: (b: BroadcastRow) => void;
}) {
  const [message, setMessage] = useState("");
  const [recipientType, setRecipientType] = useState<"all" | "staff" | "vendors">("all");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    setErr(null);
    const { data, error } = await createClient()
      .from("event_broadcasts")
      .insert({ event_id: eventId, promoter_id: userId, message: message.trim(), recipient_type: recipientType })
      .select("id, message, recipient_type, created_at")
      .single();
    if (error) setErr(error.message);
    else if (data) { onSent(data as BroadcastRow); setMessage(""); }
    setSending(false);
  }

  const recipientLabels: Record<string, string> = { all: "Everyone", staff: "Staff Only", vendors: "All Vendors" };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          {(["all", "staff", "vendors"] as const).map((t) => (
            <button key={t} onClick={() => setRecipientType(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${recipientType === t ? "bg-indigo-600 text-white" : "border border-white/[0.08] text-zinc-400 hover:text-white"}`}>
              {recipientLabels[t]}
            </button>
          ))}
        </div>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          placeholder={`Broadcast a message to ${recipientLabels[recipientType].toLowerCase()}…`}
          className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none" />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={send} disabled={sending || !message.trim()}
          className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {broadcasts.length === 0 ? (
        <EmptyState
          icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>}
          title="No broadcasts yet"
          sub="Send a message to staff and/or vendors for this event"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {broadcasts.map((b) => (
            <div key={b.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  {recipientLabels[b.recipient_type] ?? b.recipient_type}
                </span>
                <span className="text-xs text-zinc-600">{timeAgo(b.created_at)}</span>
              </div>
              <p className="text-sm text-white">{b.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal: Add Extra Truck (Revenue tab) ──────────────────────────────────

function AddExtraTruckModal({
  eventId,
  vendorId,
  onClose,
  onAdded,
}: {
  eventId: string;
  vendorId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [squareLocationId, setSquareLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setErr("Truck name is required."); return; }
    setSaving(true);
    setErr(null);
    const { error: tErr } = await createClient()
      .from("event_vendor_extra_trucks")
      .insert({ event_id: eventId, vendor_id: vendorId, truck_name: name.trim(), square_location_id: squareLocationId.trim() || null });
    if (tErr) { setErr(tErr.message); setSaving(false); return; }
    onAdded();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Add Truck</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex flex-col gap-4 mb-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Truck Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Taco Truck"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Square Location ID (optional)</label>
            <input type="text" value={squareLocationId} onChange={(e) => setSquareLocationId(e.target.value)} placeholder="LID-XXXXX"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
          </div>
        </div>
        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 h-9 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Revenue ───────────────────────────────────────────────────────────

type RevenueTruck = {
  truck_id: string;
  truck_name: string;
  square_location_id: string | null;
  square_location_name: string | null;
  square_linked: boolean;
  transactions: number;
  revenue: number;
  error: string | null;
};
type RevenueVendor = { vendor_id: string; business_name: string; square_connected: boolean | null; vendor_total: number; trucks: RevenueTruck[] };
type RevenueData = { event_total: number; is_past: boolean; vendors: RevenueVendor[] };

type SplitRow = {
  vendor_id: string;
  vendor_percentage: number;
  promoter_percentage: number;
  site_fee_cents: number;
  settlement_mode: "real_time" | "end_of_day";
  fee_payer: "vendor" | "promoter" | "split";
  square_location_id: string | null;
};

type VendorSplitState = {
  vendor_percentage: string;
  promoter_percentage: string;
  site_fee: string;
  settlement_mode: "real_time" | "end_of_day";
  fee_payer: "vendor" | "promoter" | "split";
  square_location_id: string | null;
  saving: boolean;
  error: string | null;
  saved: boolean;
  locked: boolean;
};

type VendorTxSummary = {
  total_cents: number;
  card_cents: number;
  cash_cents: number;
};

type SquareLocation = {
  id: string;
  name: string;
  address: Record<string, string> | null;
};

function PaymentSplitsSection({ eventId, vendors, txSummaries, squareConnected }: { eventId: string; vendors: RevenueVendor[] | undefined; txSummaries: Record<string, VendorTxSummary>; squareConnected: boolean | null }) {
  const [splits, setSplits] = useState<Record<string, VendorSplitState>>({});
  const [fetchDone, setFetchDone] = useState(false);
  const [squareLocations, setSquareLocations] = useState<SquareLocation[]>([]);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [locationSaved, setLocationSaved] = useState<Record<string, boolean>>({});

  function buildState(rows: SplitRow[], vendorList: RevenueVendor[]): Record<string, VendorSplitState> {
    const map: Record<string, VendorSplitState> = {};
    for (const v of vendorList) {
      const row = rows.find(r => r.vendor_id === v.vendor_id);
      map[v.vendor_id] = {
        vendor_percentage:   row ? String(row.vendor_percentage)    : "50",
        promoter_percentage: row ? String(row.promoter_percentage)  : "50",
        site_fee:            row ? String(row.site_fee_cents / 100) : "0",
        settlement_mode:     row?.settlement_mode                   ?? "end_of_day",
        fee_payer:           row?.fee_payer                         ?? "vendor",
        square_location_id:  row?.square_location_id               ?? null,
        saving: false, error: null, saved: false, locked: false,
      };
    }
    return map;
  }

  useEffect(() => {
    const vendorList = vendors ?? [];
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("event_vendor_splits")
          .select("vendor_id, vendor_percentage, promoter_percentage, site_fee_cents, settlement_mode, fee_payer, square_location_id")
          .eq("event_id", eventId);
        if (!error) {
          setSplits(buildState((data as SplitRow[]) ?? [], vendorList));
        } else {
          setSplits(buildState([], vendorList));
        }
      } catch {
        setSplits(buildState([], vendorList));
      } finally {
        setFetchDone(true);
      }
    })();
  }, [eventId]); // vendors intentionally omitted — stable after data loads, re-fetch on eventId change only

  useEffect(() => {
    if (!squareConnected) return;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-square-locations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ event_id: eventId }),
          }
        );
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        setSquareLocations(json.locations ?? []);
      } catch {
        setLocationsError("Could not load Square locations. Check your Square connection.");
      }
    })();
  }, [eventId, squareConnected]);

  function patch(vendorId: string, changes: Partial<VendorSplitState>) {
    setSplits(prev => ({ ...prev, [vendorId]: { ...prev[vendorId], ...changes } }));
  }

  async function saveLocation(vendorId: string, locationId: string) {
    const supabase = createClient();
    const newLocationId = locationId || null;
    const { error } = await supabase
      .from("event_vendor_splits")
      .update({ square_location_id: newLocationId })
      .eq("event_id", eventId)
      .eq("vendor_id", vendorId);
    if (!error) {
      patch(vendorId, { square_location_id: newLocationId });
      setLocationSaved(prev => ({ ...prev, [vendorId]: true }));
      setTimeout(() => setLocationSaved(prev => ({ ...prev, [vendorId]: false })), 2000);
    }
  }

  async function saveSplit(vendorId: string) {
    const s = splits[vendorId];
    const vp = parseFloat(s.vendor_percentage);
    const pp = parseFloat(s.promoter_percentage);
    if (!isFinite(vp) || !isFinite(pp) || Math.round(vp + pp) !== 100) {
      patch(vendorId, { error: "Percentages must add to 100" });
      return;
    }
    patch(vendorId, { saving: true, error: null, saved: false });
    const supabase = createClient();
    const { error } = await supabase
      .from("event_vendor_splits")
      .upsert(
        {
          event_id: eventId,
          vendor_id: vendorId,
          square_location_id: s.square_location_id,
          vendor_percentage: vp,
          promoter_percentage: pp,
          royalty_percentage: 0,
          site_fee_cents: Math.round((parseFloat(s.site_fee) || 0) * 100),
          settlement_mode: s.settlement_mode,
          fee_payer: s.fee_payer,
        },
        { onConflict: "event_id,vendor_id" }
      );
    patch(vendorId, { saving: false, error: error?.message ?? null, saved: !error });
  }

  if (!fetchDone) return <div className="py-6 text-center text-xs text-zinc-500">Loading split config…</div>;

  const vendorList = vendors ?? [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Payment Splits</p>
      {locationsError && (
        <p className="text-xs text-red-400">{locationsError}</p>
      )}
      {vendorList.length === 0 && (
        <p className="text-xs text-zinc-600">No vendors on this event yet.</p>
      )}
      {vendorList.map((v) => {
        const s = splits[v.vendor_id];
        if (!s) return null;
        const vp = parseFloat(s.vendor_percentage) || 0;
        const pp = parseFloat(s.promoter_percentage) || 0;
        const sumOk = Math.round(vp + pp) === 100;
        return (
          <div key={v.vendor_id} className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
            <p className="text-sm font-semibold text-white">{v.business_name}</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Vendor %</label>
                <input
                  type="number" min="0" max="100" step="1"
                  value={s.vendor_percentage}
                  onChange={(e) => {
                    const val = e.target.value;
                    patch(v.vendor_id, {
                      vendor_percentage: val,
                      promoter_percentage: String(Math.max(0, 100 - (parseFloat(val) || 0))),
                    });
                  }}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-amber-500/50 [appearance:textfield]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Promoter %</label>
                <input
                  type="number" min="0" max="100" step="1"
                  value={s.promoter_percentage}
                  onChange={(e) => {
                    const val = e.target.value;
                    patch(v.vendor_id, {
                      promoter_percentage: val,
                      vendor_percentage: String(Math.max(0, 100 - (parseFloat(val) || 0))),
                    });
                  }}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-amber-500/50 [appearance:textfield]"
                />
              </div>
            </div>
            {!sumOk && <p className="-mt-1 text-xs text-red-400">Must add to 100%</p>}

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Site Fee</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={s.site_fee}
                  onChange={(e) => patch(v.vendor_id, { site_fee: e.target.value })}
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-2 pl-7 pr-3 text-sm text-white outline-none transition-colors focus:border-amber-500/50 [appearance:textfield]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Settlement</label>
                <select
                  value={s.settlement_mode}
                  onChange={(e) => patch(v.vendor_id, { settlement_mode: e.target.value as "real_time" | "end_of_day" })}
                  className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-amber-500/50 [color-scheme:dark]"
                >
                  <option value="end_of_day">End of Day</option>
                  <option value="real_time">Real-time</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Crewbase Fee Paid By</label>
                <select
                  value={s.fee_payer}
                  onChange={(e) => patch(v.vendor_id, { fee_payer: e.target.value as "vendor" | "promoter" | "split" })}
                  className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-amber-500/50 [color-scheme:dark]"
                >
                  <option value="vendor">Vendor</option>
                  <option value="promoter">Promoter</option>
                  <option value="split">Split</option>
                </select>
              </div>
            </div>

            {squareLocations.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Square Location</label>
                <select
                  value={s.square_location_id ?? ""}
                  onChange={(e) => saveLocation(v.vendor_id, e.target.value)}
                  className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-amber-500/50 [color-scheme:dark]"
                >
                  <option value="">-- Select a location --</option>
                  {squareLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
                {locationSaved[v.vendor_id] && (
                  <p className="text-xs text-emerald-400">Saved ✓</p>
                )}
              </div>
            )}

            {s.error && <p className="text-xs text-red-400">{s.error}</p>}
            {s.saved && !s.error && <p className="text-xs text-emerald-400">Saved</p>}

            <button
              onClick={() => saveSplit(v.vendor_id)}
              disabled={s.saving || !sumOk}
              className="self-start rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              {s.saving ? "Saving…" : "Save Split"}
            </button>

            {(() => {
              const tx = txSummaries[v.vendor_id];
              if (!tx || tx.total_cents === 0) return null;
              const siteFeeCents = Math.round((parseFloat(s.site_fee) || 0) * 100);
              const crewbaseFeeCents = Math.round(tx.total_cents * 0.0295);
              const remainder = tx.total_cents - crewbaseFeeCents;
              const promoterCutCents = Math.round(remainder * (pp / 100));
              const vendorCutCents = Math.round(remainder * (vp / 100));
              const netVendorPayoutCents = vendorCutCents - siteFeeCents;
              const fmt = (cents: number) =>
                `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
              return (
                <div className="rounded-lg border border-white/[0.04] bg-black/20 px-4 py-3 flex flex-col gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-0.5">Split Breakdown</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Total Sales</span>
                    <span className="text-white font-medium">{fmt(tx.total_cents)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Card</span>
                    <span className="text-zinc-300">{fmt(tx.card_cents)}</span>
                  </div>
                  {tx.cash_cents > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Cash <span className="text-amber-400">(manual collection)</span></span>
                      <span className="text-zinc-300">{fmt(tx.cash_cents)}</span>
                    </div>
                  )}
                  <div className="my-0.5 border-t border-white/[0.06]" />
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Crewbase Fee (2.95%)</span>
                    <span className="text-red-400">−{fmt(crewbaseFeeCents)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Promoter Cut ({pp}%)</span>
                    <span className="text-zinc-300">{fmt(promoterCutCents)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Vendor Cut ({vp}%)</span>
                    <span className="text-zinc-300">{fmt(vendorCutCents)}</span>
                  </div>
                  {siteFeeCents > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Site Fee</span>
                      <span className="text-red-400">−{fmt(siteFeeCents)}</span>
                    </div>
                  )}
                  <div className="my-0.5 border-t border-white/[0.06]" />
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-zinc-300">Net Vendor Payout</span>
                    <span className={netVendorPayoutCents >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {netVendorPayoutCents < 0 ? "−" : ""}{fmt(netVendorPayoutCents)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

function RevenueTab({ eventId }: { eventId: string }) {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [squareToast, setSquareToast] = useState(false);
  const [addTruckFor, setAddTruckFor] = useState<string | null>(null);

  // Check whether a Square config already exists for this event
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: cfg, error: cfgError } = await supabase
          .from("event_square_config")
          .select("id")
          .eq("event_id", eventId)
          .maybeSingle();
        if (cfgError) {
          console.error("event_square_config query error:", cfgError.message);
          setSquareConnected(false);
        } else {
          setSquareConnected(cfg !== null);
        }
      } catch (e) {
        console.error("event_square_config fetch threw:", e);
        setSquareConnected(false);
      }
    })();
  }, [eventId]);

  // Show success toast if redirected back from Square OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("square") === "connected") {
      setSquareConnected(true);
      setSquareToast(true);
      const t = setTimeout(() => setSquareToast(false), 4000);
      return () => clearTimeout(t);
    }
  }, []);

  async function fetchRevenue() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Not authenticated"); setLoading(false); return; }
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/vendor-event-revenue`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ event_id: eventId }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load revenue");
    }
    setLoading(false);
  }

  useEffect(() => { fetchRevenue(); }, [eventId]);

  if (loading) return <div className="text-center py-16 text-zinc-500 text-sm">Loading revenue…</div>;
  if (error)   return <div className="text-center py-16 text-red-400 text-sm">{error}</div>;
  if (!data)   return null;

  return (
    <div className="flex flex-col gap-4">
      {squareToast && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-medium text-emerald-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          Square account connected successfully!
        </div>
      )}

      {data.is_past && (
        <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/5 px-4 py-3 text-xs text-zinc-400">
          Final snapshot — event completed
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-6 text-center">
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Total Event Revenue</p>
        <p className="text-4xl font-bold text-white">
          ${(data.event_total ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </p>
        <p className="text-xs text-zinc-500 mt-2">
          {data.vendors.length} vendor{data.vendors.length !== 1 ? "s" : ""}
          {!data.is_past && <span className="ml-2 text-amber-400">· Event ongoing</span>}
        </p>
      </div>

      {data.vendors.length > 0 && (
        <div className="flex flex-col gap-3">
          {data.vendors.map((v) => (
            <div key={v.vendor_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center text-sm font-bold shrink-0">
                    {v.business_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white">{v.business_name}</p>
                      {v.square_connected ? (
                        <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                          Square Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          Square Not Connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">${(v.vendor_total ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <button
                  onClick={() => setAddTruckFor(v.vendor_id)}
                  className="rounded-full border border-white/[0.08] px-3 py-1 text-xs font-medium text-zinc-400 hover:text-white hover:border-white/20 transition-colors shrink-0"
                >
                  + Add truck
                </button>
              </div>
              {v.trucks.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {v.trucks.map((t) => (
                    <div key={t.truck_id} className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white">{t.truck_name}</p>
                        {t.square_linked && t.square_location_name ? (
                          <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                            <span className="text-emerald-400">✓</span>
                            {t.square_location_name}
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-600 mt-0.5">not linked</p>
                        )}
                      </div>
                      {t.square_linked && (
                        <div className="text-right shrink-0">
                          <p className="text-xs font-medium text-white">${(t.revenue ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                          <p className="text-xs text-zinc-500">{t.transactions} txn{t.transactions !== 1 ? "s" : ""}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={fetchRevenue}
        className="self-end rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
      >
        ↻ Refresh
      </button>

      {addTruckFor && (
        <AddExtraTruckModal
          eventId={eventId}
          vendorId={addTruckFor}
          onClose={() => setAddTruckFor(null)}
          onAdded={() => { setAddTruckFor(null); fetchRevenue(); }}
        />
      )}
    </div>
  );
}

// ── Splits tab ────────────────────────────────────────────────────────────

type EventVendorWithCategory = {
  vendor_id: string;
  business_name: string;
  category: string | null;
};

const SPLIT_DEF: VendorSplitState = {
  vendor_percentage: "50", promoter_percentage: "50",
  site_fee: "0", settlement_mode: "end_of_day", fee_payer: "vendor",
  square_location_id: null, saving: false, error: null, saved: false, locked: false,
};

function SplitsTab({ eventId }: { eventId: string }) {
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [vendors,    setVendors]    = useState<EventVendorWithCategory[]>([]);
  const [txByVendor, setTxByVendor] = useState<Record<string, number>>({});
  const [splits,     setSplits]     = useState<Record<string, VendorSplitState>>({});

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();

        // 1. Vendors with category
        const { data: evRows } = await supabase
          .from("event_vendors")
          .select("vendor_id, category")
          .eq("event_id", eventId);
        const vendorIds = (evRows ?? []).map((r: { vendor_id: string }) => r.vendor_id);
        const categoryByVendor: Record<string, string | null> = {};
        for (const r of evRows ?? []) categoryByVendor[r.vendor_id] = r.category ?? null;

        if (vendorIds.length > 0) {
          const { data: profiles } = await supabase
            .from("vendor_profiles")
            .select("user_id, business_name")
            .in("user_id", vendorIds);
          setVendors((profiles ?? []).map((p: { user_id: string; business_name: string }) => ({
            vendor_id: p.user_id,
            business_name: p.business_name,
            category: categoryByVendor[p.user_id] ?? null,
          })));
        }

        // 2. Transaction totals per vendor from square_transactions
        const { data: txRows } = await supabase
          .from("square_transactions")
          .select("vendor_id, amount_cents")
          .eq("event_id", eventId);
        const totals: Record<string, number> = {};
        for (const row of txRows ?? []) {
          totals[row.vendor_id] = (totals[row.vendor_id] ?? 0) + (row.amount_cents ?? 0);
        }
        setTxByVendor(totals);

        // 3. Category splits
        const { data: splitRows } = await supabase
          .from("event_category_splits")
          .select("category, vendor_percentage, promoter_percentage")
          .eq("event_id", eventId);
        const splitMap: Record<string, VendorSplitState> = {};
        for (const row of splitRows ?? []) {
          splitMap[row.category] = {
            vendor_percentage:   String(row.vendor_percentage ?? 50),
            promoter_percentage: String(row.promoter_percentage ?? 50),
            site_fee: "0", settlement_mode: "end_of_day", fee_payer: "vendor",
            square_location_id:  null,
            saving: false, error: null, saved: false, locked: true,
          };
        }
        setSplits(splitMap);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(cat: string, changes: Partial<VendorSplitState>) {
    setSplits(prev => ({ ...prev, [cat]: { ...prev[cat], ...changes } }));
  }

  async function saveSplit(cat: string) {
    const s = splits[cat] ?? SPLIT_DEF;
    const vp = parseFloat(s.vendor_percentage);
    const pp = parseFloat(s.promoter_percentage);
    if (!isFinite(vp) || !isFinite(pp) || Math.round(vp + pp) !== 100) {
      patch(cat, { error: "Percentages must add to 100" });
      return;
    }
    patch(cat, { saving: true, error: null, saved: false });
    const { error } = await createClient()
      .from("event_category_splits")
      .upsert(
        {
          event_id: eventId,
          category: cat,
          vendor_percentage: vp,
          promoter_percentage: pp,
        },
        { onConflict: "event_id,category" }
      );
    if (error) {
      patch(cat, { saving: false, error: error.message });
    } else {
      patch(cat, { saving: false, error: null, saved: false, locked: true });
    }
  }

  if (loading) return <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>;
  if (error)   return <div className="py-16 text-center text-sm text-red-400">{error}</div>;

  // Derive unique categories, group vendors
  const categories = Array.from(new Set(vendors.map(v => v.category ?? "Other"))).sort();
  const vendorsByCategory: Record<string, EventVendorWithCategory[]> = {};
  for (const v of vendors) {
    const cat = v.category ?? "Other";
    (vendorsByCategory[cat] ??= []).push(v);
  }

  const hasAnyRevenue = Object.values(txByVendor).some(v => v > 0);
  const fmtD = (n: number) => `$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  return (
    <div className="flex flex-col gap-6">

      {/* SECTION 1 — SPLIT SETTINGS */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Split Settings</p>
        {vendors.length === 0 && (
          <p className="text-xs text-zinc-600">No vendors on this event yet.</p>
        )}
        {categories.map((cat) => {
          const s = splits[cat] ?? SPLIT_DEF;
          const catVendors = vendorsByCategory[cat] ?? [];

          if (s.locked) {
            return (
              <div key={cat} className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white">{cat}</p>
                  <span className="text-xs text-zinc-500">🔒 Split Locked</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium uppercase tracking-wider text-zinc-600">Vendor %</span>
                    <span className="text-sm text-zinc-300">{s.vendor_percentage}%</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium uppercase tracking-wider text-zinc-600">Promoter %</span>
                    <span className="text-sm text-zinc-300">{s.promoter_percentage}%</span>
                  </div>
                </div>
                {catVendors.length > 0 && (
                  <p className="text-xs text-zinc-600">{catVendors.map(v => v.business_name).join(", ")}</p>
                )}
              </div>
            );
          }

          return (
            <div key={cat} className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <p className="text-sm font-semibold text-white">{cat}</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Vendor %</label>
                  <input
                    type="number" min="0" max="100" step="1"
                    value={s.vendor_percentage}
                    onChange={(e) => {
                      const val = e.target.value;
                      patch(cat, {
                        vendor_percentage:   val,
                        promoter_percentage: String(Math.max(0, 100 - (parseFloat(val) || 0))),
                      });
                    }}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-amber-500/50 [appearance:textfield]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Promoter %</label>
                  <input
                    type="number"
                    value={s.promoter_percentage}
                    readOnly
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-zinc-400 outline-none cursor-not-allowed [appearance:textfield]"
                  />
                </div>
              </div>

              {s.error && <p className="text-xs text-red-400">{s.error}</p>}
              <button
                onClick={() => saveSplit(cat)}
                disabled={s.saving}
                className="self-start rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
              >
                {s.saving ? "Saving…" : "Save Split"}
              </button>

              {catVendors.length > 0 && (
                <p className="text-xs text-zinc-600">
                  {catVendors.map(v => v.business_name).join(", ")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* SECTION 2 — TRANSACTION BREAKDOWN */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Transaction Breakdown</p>
        {!hasAnyRevenue ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center">
            <p className="text-sm text-zinc-500">No transaction data yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {categories.map((cat) => {
              const catVendors = (vendorsByCategory[cat] ?? []).filter(v => (txByVendor[v.vendor_id] ?? 0) > 0);
              if (catVendors.length === 0) return null;

              const splitSet = !!splits[cat];
              const vp = splitSet ? (parseFloat(splits[cat].vendor_percentage) || 0) : null;
              const pp = splitSet ? (parseFloat(splits[cat].promoter_percentage) || 0) : null;
              const catTotalCents = catVendors.reduce((sum, v) => sum + (txByVendor[v.vendor_id] ?? 0), 0);

              return (
                <div key={cat} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
                    <p className="text-sm font-semibold text-white">{cat}</p>
                    <p className="text-sm font-semibold text-white">{fmtD(catTotalCents)}</p>
                  </div>
                  {catVendors.map((v) => {
                    const totalCents = txByVendor[v.vendor_id] ?? 0;
                    return (
                      <div key={v.vendor_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex flex-col gap-1.5">
                        <p className="text-xs font-semibold text-zinc-300">{v.business_name}</p>
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-400">Total Sales</span>
                          <span className="text-white">{fmtD(totalCents)}</span>
                        </div>
                        {vp !== null && pp !== null ? (
                          <>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Vendor Cut ({vp}%)</span>
                              <span className="text-zinc-300">{fmtD(totalCents * (vp / 100))}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Promoter Cut ({pp}%)</span>
                              <span className="text-zinc-300">{fmtD(totalCents * (pp / 100))}</span>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-zinc-600 italic">Set split percentages above first</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 3 — SETTLE EVENT placeholder */}
      <div className="relative">
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <span className="rounded-full border border-zinc-500/40 bg-[#0a0a0a] px-3 py-1 text-xs font-semibold text-zinc-500">Coming Soon</span>
        </div>
        <div className="pointer-events-none select-none flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-6 opacity-40">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Settle Event</p>
          <button disabled className="self-start rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-medium text-zinc-500">Settle Event</button>
          <p className="text-xs text-zinc-600">Finalises the event, confirms all splits and generates Crewbase invoice — coming soon</p>
        </div>
      </div>

    </div>
  );
}

// ── Cancel confirm ─────────────────────────────────────────────────────────

function CancelConfirm({ eventId, userId, onDone }: { eventId: string; userId: string; onDone: () => void }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);

  async function doCancel() {
    setCancelling(true);
    await createClient().from("events").update({ status: "cancelled" }).eq("id", eventId).eq("promoter_id", userId);
    router.replace("/dashboard");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-[#141414] p-6">
        <p className="text-sm text-rose-300 font-medium mb-2">Cancel this event?</p>
        <p className="text-xs text-zinc-500 mb-5">This cannot be undone. All staff and vendors will be notified.</p>
        <div className="flex gap-3">
          <button onClick={onDone} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Keep Event</button>
          <button onClick={doCancel} disabled={cancelling} className="flex-1 h-9 rounded-lg bg-rose-600 text-sm font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50">
            {cancelling ? "Cancelling…" : "Yes, Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "vendors",   label: "Vendors" },
  { key: "staff",     label: "Staff" },
  { key: "checkins",  label: "Check-ins" },
  { key: "gatestaff", label: "Gate Staff" },
  { key: "docs",      label: "Docs" },
  { key: "broadcast", label: "Broadcast" },
  { key: "revenue",   label: "Revenue" },
  { key: "splits",    label: "Splits" },
];

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();

  const [event,        setEvent]        = useState<EventRow | null>(null);
  const [vendorRows,   setVendorRows]   = useState<EventVendorRow[]>([]);
  const [staffRows,      setStaffRows]      = useState<EventStaffRow[]>([]);
  const [staffProfiles,  setStaffProfiles]  = useState<Record<string, StaffProfile>>({});
  const [staffVendorMap, setStaffVendorMap] = useState<Record<string, string>>({}); // staffId → vendorId
  const [checkins,     setCheckins]     = useState<CheckinRow[]>([]);
  const [checkinNames, setCheckinNames] = useState<Record<string, string>>({});
  const [docs,         setDocs]         = useState<DocRow[]>([]);
  const [broadcasts,   setBroadcasts]   = useState<BroadcastRow[]>([]);
  const [docRequests,  setDocRequests]  = useState<DocRequestRow[]>([]);
  const [staffCounts,  setStaffCounts]  = useState<Record<string, number>>({});
  const [trucks,       setTrucks]       = useState<VendorTruck[]>([]);
  const [dateChangeReq,setDateChangeReq]= useState<DateChangeRequest | null>(null);
  const [activeTab,    setActiveTab]    = useState<Tab>("vendors");
  const [dataLoading,  setDataLoading]  = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [showDateEdit, setShowDateEdit] = useState(false);
  const [showCancel,   setShowCancel]   = useState(false);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const supabase = createClient();

      // 1. Event
      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id, name, location, start_date, end_date, timezone, status, description, promoter_id")
        .eq("id", id)
        .single();

      if (evErr || !ev) { setError("Event not found."); setDataLoading(false); return; }
      if (ev.promoter_id !== user!.id) { setError("Access denied."); setDataLoading(false); return; }
      setEvent(ev as EventRow);

      // 2. Parallel fetches
      const [evRes, esRes, docsRes, bcastRes, drRes, dcRes] = await Promise.all([
        supabase.from("event_vendors").select("vendor_id, status, staff_limit, category").eq("event_id", id),
        supabase.from("event_staff").select("staff_id, status, is_gate_staff, vendor_id").eq("event_id", id),
        supabase.from("event_documents").select("id, title, type, content, file_url, created_at").eq("event_id", id),
        supabase.from("event_broadcasts").select("id, message, recipient_type, created_at").eq("event_id", id).order("created_at", { ascending: false }),
        supabase.from("event_document_requests").select("id, vendor_id, status").eq("event_id", id),
        supabase.from("event_date_change_requests").select("id, status, new_start_time, new_end_time").eq("event_id", id).eq("status", "pending").maybeSingle(),
      ]);

      const rawVendors = (evRes.data ?? []) as { vendor_id: string; status: string; staff_limit: number | null; category: string | null }[];
      const rawStaff   = (esRes.data   ?? []) as EventStaffRow[];

      setDocs((docsRes.data as DocRow[]) ?? []);
      setBroadcasts((bcastRes.data as BroadcastRow[]) ?? []);
      setDocRequests((drRes.data as DocRequestRow[]) ?? []);
      setDateChangeReq((dcRes.data as DateChangeRequest | null) ?? null);
      setStaffRows(rawStaff);

      // 3. Vendor profiles (user_id = vendor_id in event_vendors)
      const vendorUserIds = rawVendors.map((v) => v.vendor_id);
      let profileMap: Record<string, VendorProfile> = {};
      if (vendorUserIds.length > 0) {
        const { data: vp } = await supabase
          .from("vendor_profiles")
          .select("id, user_id, business_name, username")
          .in("user_id", vendorUserIds);
        for (const p of (vp ?? []) as VendorProfile[]) {
          profileMap[p.user_id] = p;
        }
      }
      setVendorRows(rawVendors.map((v) => ({ ...v, profile: profileMap[v.vendor_id] ?? null })));

      // 4. Staff profiles (staff_profiles.user_id = event_staff.staff_id = auth uid)
      const staffIds = rawStaff.map((s) => s.staff_id);
      if (staffIds.length > 0) {
        const { data: sp } = await supabase
          .from("staff_profiles")
          .select("user_id, full_name")
          .in("user_id", staffIds);
        const spMap: Record<string, StaffProfile> = {};
        for (const p of (sp ?? []) as StaffProfile[]) spMap[p.user_id] = p;
        setStaffProfiles(spMap);

        // 4b. staff_vendor_assignments: which vendor is responsible for each staff member
        if (vendorUserIds.length > 0) {
          const { data: sva } = await supabase
            .from("staff_vendor_assignments")
            .select("staff_id, vendor_id")
            .in("staff_id", staffIds)
            .in("vendor_id", vendorUserIds);
          const svaMap: Record<string, string> = {};
          for (const r of (sva ?? []) as { staff_id: string; vendor_id: string }[]) {
            svaMap[r.staff_id] = r.vendor_id;
          }
          setStaffVendorMap(svaMap);
        }
      }

      // 5. Vendor staff counts via RPC
      if (vendorUserIds.length > 0) {
        const { data: counts } = await supabase.rpc("get_vendor_staff_counts", { p_event_id: id });
        const countMap: Record<string, number> = {};
        for (const row of (counts ?? []) as VendorStaffCount[]) {
          countMap[row.vendor_id] = row.staff_count;
        }
        setStaffCounts(countMap);
      }

      // 6. Vendor trucks
      if (vendorUserIds.length > 0) {
        const { data: truckData } = await supabase
          .from("vendor_trucks")
          .select("id, name, vendor_id")
          .in("vendor_id", vendorUserIds);
        setTrucks((truckData as VendorTruck[]) ?? []);
      }

      // 7. Check-ins
      const { data: ciData } = await supabase
        .from("event_checkins")
        .select("user_id, checked_in_at, status")
        .eq("event_id", id)
        .order("checked_in_at", { ascending: false });

      const ciRows = (ciData as CheckinRow[]) ?? [];
      setCheckins(ciRows);

      if (ciRows.length > 0) {
        const ciUserIds = ciRows.map((c) => c.user_id);
        const { data: ciUsers } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", ciUserIds);
        const nameMap: Record<string, string> = {};
        for (const u of (ciUsers ?? []) as { id: string; full_name: string }[]) nameMap[u.id] = u.full_name;
        setCheckinNames(nameMap);
      }

      setDataLoading(false);
    }
    load();
  }, [user?.id, id]);

  function handleToggleGate(staffId: string, val: boolean) {
    setStaffRows((prev) => prev.map((s) => s.staff_id === staffId ? { ...s, is_gate_staff: val } : s));
  }

  function handleAddGateStaff(row: EventStaffRow, profile: StaffProfile) {
    setStaffRows((prev) => [...prev, row]);
    setStaffProfiles((prev) => ({ ...prev, [profile.user_id]: profile }));
  }

  function handleRemoveGateStaff(staffId: string) {
    setStaffRows((prev) => prev.filter((s) => s.staff_id !== staffId));
  }

  if (authLoading || dataLoading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  if (error || !event) {
    return <div className="flex items-center justify-center h-64"><span className="text-red-400 text-sm">{error ?? "Something went wrong."}</span></div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-5">
        <Link href="/dashboard" className="hover:text-zinc-300 transition-colors">Events</Link>
        <span>/</span>
        <span className="text-zinc-300 truncate">{event.name}</span>
      </div>

      {/* Date change pending banner */}
      {dateChangeReq && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFD60A" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div>
            <p className="text-xs font-semibold text-amber-400">Date Change — Awaiting Vendor Approval</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Proposed: {fmtDate(dateChangeReq.new_start_time)} → {fmtDate(dateChangeReq.new_end_time)}
            </p>
          </div>
        </div>
      )}

      {/* Event header */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h1 className="text-xl font-bold text-white leading-tight">{event.name}</h1>
          <button onClick={() => setShowCancel(true)}>
            <Badge status={deriveDisplayStatus(event)} />
          </button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 items-center">
          <span>{fmtDate(event.start_date)}</span>
          {event.end_date && event.end_date !== event.start_date && <><span>→</span><span>{fmtDate(event.end_date)}</span></>}
          {event.location && <><span>·</span><span>{event.location}</span></>}
          <button onClick={() => setShowDateEdit(true)} className="text-zinc-600 hover:text-zinc-300 transition-colors ml-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
        {event.description && (
          <p className="mt-3 text-xs text-zinc-500 leading-relaxed">{event.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab.key ? "text-white border-indigo-500" : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "vendors" && (
        <VendorsTab
          vendorRows={vendorRows}
          setVendorRows={setVendorRows}
          docRequests={docRequests}
          setDocRequests={setDocRequests}
          staffCounts={staffCounts}
          trucks={trucks}
          setTrucks={setTrucks}
          eventId={event.id}
          userId={user!.id}
        />
      )}
      {activeTab === "staff" && (
        <StaffTab
          staffRows={staffRows}
          staffProfiles={staffProfiles}
          staffVendorMap={staffVendorMap}
          vendorRows={vendorRows}
          eventId={event.id}
          onToggleGate={handleToggleGate}
        />
      )}
      {activeTab === "checkins" && (
        <CheckInsTab checkins={checkins} userNames={checkinNames} />
      )}
      {activeTab === "gatestaff" && (
        <GateStaffTab
          staffRows={staffRows}
          staffProfiles={staffProfiles}
          eventId={event.id}
          onAdd={handleAddGateStaff}
          onRemove={handleRemoveGateStaff}
        />
      )}
      {activeTab === "docs" && (
        <DocsTab
          docs={docs}
          setDocs={setDocs}
          eventId={event.id}
          userId={user!.id}
          staffRows={staffRows}
          staffProfiles={staffProfiles}
          vendorRows={vendorRows}
        />
      )}
      {activeTab === "broadcast" && (
        <BroadcastTab
          eventId={event.id}
          userId={user!.id}
          broadcasts={broadcasts}
          onSent={(b) => setBroadcasts((p) => [b, ...p])}
        />
      )}
      {activeTab === "revenue" && <RevenueTab eventId={event.id} />}
      {activeTab === "splits"  && <SplitsTab  eventId={event.id} />}

      {/* Modals */}
      {showDateEdit && (
        <DateEditModal
          event={event}
          vendorCount={vendorRows.length}
          userId={user!.id}
          onClose={() => setShowDateEdit(false)}
          onUpdated={(s, e2) => { setEvent((prev) => prev ? { ...prev, start_date: s, end_date: e2 } : prev); setShowDateEdit(false); }}
        />
      )}
      {showCancel && (
        <CancelConfirm
          eventId={event.id}
          userId={user!.id}
          onDone={() => setShowCancel(false)}
        />
      )}
    </div>
  );
}

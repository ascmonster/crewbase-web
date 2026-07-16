"use client";

import { useEffect, useRef, useState } from "react";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────
// NOTE: `documents`, `vendor_business_documents`, and `event_document_submissions`
// are not referenced elsewhere in the codebase, so their exact columns are
// unverified. Rows are normalized defensively (see normDoc) to tolerate common
// column-name variants. `event_document_requests.vendor_id` = vendor_profiles.id.

type DocRow = {
  id: string;
  file_name: string;
  document_type: string | null;
  storage_path: string | null;
  file_url: string | null;
  created_at: string;
  viewed: boolean | null;
};

// Prettify a doc_type slug, e.g. "public_liability" → "Public Liability".
function prettyDocType(t: string | null) {
  if (!t) return null;
  return t.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type EventRequestRow = {
  id: string;
  event_id: string;
  event_name: string;
  doc_types: string[] | null;
  status: string;
  due_date: string | null;
};

function isOverdue(r: EventRequestRow) {
  return r.status.toLowerCase() === "pending" && !!r.due_date && new Date(r.due_date).getTime() < Date.now();
}

type Tab = "my" | "business" | "requests";
type UploadTarget = "my" | "business";

const DOC_TYPES = ["Contract", "Insurance", "License", "Other"];

// ── Helpers ────────────────────────────────────────────────────────────────

const REQ_STATUS_CFG: Record<string, string> = {
  pending:   "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
  submitted: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  approved:  "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  overdue:   "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
  rejected:  "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
};

function reqStatusCls(s: string) {
  return REQ_STATUS_CFG[s.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20";
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normDoc(raw: any): DocRow {
  return {
    id: raw.id,
    file_name: raw.file_name ?? raw.name ?? raw.title ?? "Document",
    document_type: raw.document_type ?? raw.doc_type ?? raw.type ?? null,
    storage_path: raw.storage_path ?? raw.file_path ?? raw.path ?? null,
    file_url: raw.file_url ?? null,
    created_at: raw.created_at ?? raw.uploaded_at ?? "",
    viewed: raw.viewed_by_promoter ?? (raw.viewed_at ? true : null) ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const BUCKET: Record<UploadTarget, string> = { my: "documents", business: "business-documents" };
const TABLE: Record<UploadTarget, string> = { my: "documents", business: "vendor_business_documents" };

// ── Atoms ──────────────────────────────────────────────────────────────────

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
          <div className="h-3 w-1/4 rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// ── Upload modal ───────────────────────────────────────────────────────────

function UploadModal({ target, vendorId, onClose, onUploaded }: {
  target: UploadTarget;
  vendorId: string;
  onClose: () => void;
  onUploaded: (doc: DocRow) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!file) { setErr("Choose a file to upload."); return; }
    setSaving(true);
    setErr(null);
    const supabase = createClient();

    const path = `${vendorId}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from(BUCKET[target]).upload(path, file);
    if (upErr) { setErr(upErr.message); setSaving(false); return; }

    const { data, error } = await supabase
      .from(TABLE[target])
      .insert({ vendor_id: vendorId, file_name: file.name, document_type: docType, storage_path: path })
      .select("*")
      .single();

    if (error) { setErr(error.message); setSaving(false); return; }
    onUploaded(normDoc(data));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">{target === "business" ? "Upload Business Doc" : "Upload Document"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">File</label>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#FF6B35]/15 file:text-[#FF6B35] file:text-xs file:font-medium hover:file:bg-[#FF6B35]/25 transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Document Type</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-2.5 text-sm text-white outline-none focus:border-[#FF6B35] transition-colors [color-scheme:dark]"
            >
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-3 mt-1">
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#FF6B35] text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {saving ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Document row ───────────────────────────────────────────────────────────

function DocRowItem({ doc, bucket, onDelete, showViewed }: {
  doc: DocRow;
  bucket: string;
  onDelete: (id: string) => void;
  showViewed?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);
  const canView = !!doc.file_url || !!doc.storage_path;

  async function view() {
    // Business docs carry a full public file_url — open it directly.
    if (doc.file_url) { window.open(doc.file_url, "_blank"); return; }
    if (!doc.storage_path) return;
    setOpening(true);
    try {
      const { data, error } = await createClient().storage.from(bucket).createSignedUrl(doc.storage_path, 60 * 60);
      if (!error && data?.signedUrl) window.open(data.signedUrl, "_blank");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
      <FileIcon />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{doc.file_name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {doc.document_type && (
            <span className="rounded-full bg-[#FF6B35]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FF6B35]">{prettyDocType(doc.document_type)}</span>
          )}
          <span className="text-xs text-zinc-600">{fmtDate(doc.created_at)}</span>
          {showViewed && doc.viewed != null && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${doc.viewed ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-400"}`}>
              {doc.viewed ? "Viewed by promoter" : "Not viewed"}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canView && (
          <button onClick={view} disabled={opening} className="rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors disabled:opacity-50">
            {opening ? "Opening…" : "View"}
          </button>
        )}
        {confirming ? (
          <div className="flex items-center gap-2">
            <button onClick={() => onDelete(doc.id)} className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors">Confirm</button>
            <button onClick={() => setConfirming(false)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-zinc-600 hover:text-rose-400 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorDocumentsPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const [activeTab, setActiveTab] = useState<Tab>("my");
  const [vendorProfileId, setVendorProfileId] = useState<string | null>(null);

  const [myDocs, setMyDocs] = useState<DocRow[]>([]);
  const [myLoaded, setMyLoaded] = useState(false);
  const [myLoading, setMyLoading] = useState(false);

  const [bizDocs, setBizDocs] = useState<DocRow[]>([]);
  const [bizLoaded, setBizLoaded] = useState(false);
  const [bizLoading, setBizLoading] = useState(false);

  const [requests, setRequests] = useState<EventRequestRow[]>([]);
  const [reqLoaded, setReqLoaded] = useState(false);
  const [reqLoading, setReqLoading] = useState(false);
  const [submittingReq, setSubmittingReq] = useState<string | null>(null);

  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);

  // Resolve vendor_profiles.id (needed for event_document_requests)
  useEffect(() => {
    if (!user) return;
    createClient()
      .from("vendor_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }: { data: { id: string } | null }) => setVendorProfileId(data?.id ?? null));
  }, [user?.id]);

  // My Documents lazy load
  useEffect(() => {
    if (activeTab !== "my" || myLoaded || !user) return;
    async function load() {
      setMyLoading(true);
      const { data } = await createClient()
        .from("documents")
        .select("*")
        .eq("vendor_id", user!.id)
        .order("created_at", { ascending: false });
      setMyDocs(((data ?? []) as unknown[]).map(normDoc));
      setMyLoaded(true);
      setMyLoading(false);
    }
    load();
  }, [activeTab, myLoaded, user?.id]);

  // Business Docs lazy load — vendor_business_documents.vendor_id = vendor_profiles.id (PK)
  useEffect(() => {
    if (activeTab !== "business" || bizLoaded || !user || vendorProfileId === null) return;
    async function load() {
      setBizLoading(true);
      const { data } = await createClient()
        .from("vendor_business_documents")
        .select("*")
        .eq("vendor_id", vendorProfileId)
        .order("uploaded_at", { ascending: false });
      setBizDocs(((data ?? []) as unknown[]).map(normDoc));
      setBizLoaded(true);
      setBizLoading(false);
    }
    load();
  }, [activeTab, bizLoaded, user?.id, vendorProfileId]);

  // Event Requests lazy load
  useEffect(() => {
    if (activeTab !== "requests" || reqLoaded || !user || vendorProfileId === null) return;
    async function load() {
      setReqLoading(true);
      const supabase = createClient();
      const { data: reqRows } = await supabase
        .from("event_document_requests")
        .select("*")
        .eq("vendor_id", vendorProfileId);

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const rows = (reqRows ?? []) as any[];
      const eventIds = [...new Set(rows.map((r) => r.event_id))];

      let nameMap: Record<string, string> = {};
      if (eventIds.length > 0) {
        const { data: evs } = await supabase.from("events").select("id, name").in("id", eventIds);
        nameMap = Object.fromEntries(((evs ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
      }

      setRequests(rows.map((r) => ({
        id: r.id,
        event_id: r.event_id,
        event_name: nameMap[r.event_id] ?? "Event",
        doc_types: r.doc_types,
        status: r.status,
        due_date: r.due_date ?? null,
      })));
      /* eslint-enable @typescript-eslint/no-explicit-any */
      setReqLoaded(true);
      setReqLoading(false);
    }
    load();
  }, [activeTab, reqLoaded, user?.id, vendorProfileId]);

  async function deleteDoc(target: UploadTarget, id: string) {
    await createClient().from(TABLE[target]).delete().eq("id", id);
    if (target === "my") setMyDocs((prev) => prev.filter((d) => d.id !== id));
    else setBizDocs((prev) => prev.filter((d) => d.id !== id));
  }

  async function submitRequest(req: EventRequestRow, file: File) {
    setSubmittingReq(req.id);
    const supabase = createClient();
    const path = `${req.event_id}/submissions/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("event-documents").upload(path, file);
    if (upErr) { setSubmittingReq(null); alert(upErr.message); return; }

    await supabase.from("event_document_submissions").insert({
      request_id: req.id,
      event_id: req.event_id,
      vendor_id: vendorProfileId,
      file_name: file.name,
      storage_path: path,
    });
    await supabase.from("event_document_requests").update({ status: "submitted" }).eq("id", req.id);

    setRequests((prev) => prev.map((r) => (r.id === req.id ? { ...r, status: "submitted" } : r)));
    setSubmittingReq(null);
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Digital Forms</h1>
        {(activeTab === "my" || activeTab === "business") && (
          <button
            onClick={() => setUploadTarget(activeTab)}
            className="flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {activeTab === "business" ? "Upload" : "Upload Document"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
        {([["my", "My Forms"], ["business", "Business Docs"], ["requests", "Event Requests"]] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === key ? "text-white border-[#FF6B35]" : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── My Documents ── */}
      {activeTab === "my" && (
        authLoading || myLoading ? (
          <SkeletonRows count={4} />
        ) : myDocs.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
            title="No documents yet"
            sub="Upload contracts, insurance, and licenses here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {myDocs.map((d) => (
              <DocRowItem key={d.id} doc={d} bucket={BUCKET.my} onDelete={(id) => deleteDoc("my", id)} />
            ))}
          </div>
        )
      )}

      {/* ── Business Docs ── */}
      {activeTab === "business" && (
        authLoading || bizLoading || (vendorProfileId === null && !bizLoaded) ? (
          <SkeletonRows count={4} />
        ) : bizDocs.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg>}
            title="No business documents yet"
            sub="Upload your business registration, ABN, and other records."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {bizDocs.map((d) => (
              <DocRowItem key={d.id} doc={d} bucket={BUCKET.business} onDelete={(id) => deleteDoc("business", id)} showViewed />
            ))}
          </div>
        )
      )}

      {/* ── Event Requests ── */}
      {activeTab === "requests" && (
        authLoading || reqLoading || (vendorProfileId === null && !reqLoaded) ? (
          <SkeletonRows count={3} />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>}
            title="No document requests"
            sub="Promoters' document requests will appear here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((r) => (
              <div key={r.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white truncate">{r.event_name}</p>
                    {isOverdue(r) && (
                      <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-400 ring-1 ring-rose-500/20">OVERDUE</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {r.doc_types && r.doc_types.length > 0 ? r.doc_types.join(", ") : "Document requested"}
                    {r.due_date && <span className="text-zinc-600"> · Due {fmtDate(r.due_date)}</span>}
                  </p>
                </div>
                {r.status.toLowerCase() === "pending" ? (
                  <SubmitRequestButton
                    busy={submittingReq === r.id}
                    onFile={(file) => submitRequest(r, file)}
                  />
                ) : (
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${reqStatusCls(r.status)}`}>
                    {r.status.toUpperCase()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {uploadTarget && user && (
        <UploadModal
          target={uploadTarget}
          vendorId={user.id}
          onClose={() => setUploadTarget(null)}
          onUploaded={(doc) => {
            if (uploadTarget === "my") setMyDocs((prev) => [doc, ...prev]);
            else setBizDocs((prev) => [doc, ...prev]);
          }}
        />
      )}
    </div>
  );
}

// ── Submit request button (hidden file input) ──────────────────────────────

function SubmitRequestButton({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="shrink-0 rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit"}
      </button>
    </>
  );
}

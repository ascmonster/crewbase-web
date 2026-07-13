"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { createClient } from "@/lib/supabase";

type PromoterProfile = {
  company_name: string | null;
  approval_status: string | null;
  phone: string | null;
  abn: string | null;
  abn_verified: boolean | null;
  abn_business_name: string | null;
  gst_registered: boolean | null;
};

type StaffProfile = {
  full_name: string | null;
};

type PayRates = {
  base_rate: number | null;
  saturday_rate: number | null;
  public_holiday_rate: number | null;
};

// ── Edit Profile modal ─────────────────────────────────────────────────────

function EditProfileModal({
  initial,
  userId,
  onSaved,
  onClose,
}: {
  initial: { companyName: string; fullName: string; phone: string };
  userId: string;
  onSaved: (updated: { companyName: string; fullName: string; phone: string }) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(k: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const supabase = createClient();
    const [ppRes, spRes] = await Promise.all([
      supabase
        .from("promoter_profiles")
        .upsert(
          {
            user_id: userId,
            company_name: form.companyName.trim() || null,
            phone: form.phone.trim() || null,
          },
          { onConflict: "user_id" },
        ),
      supabase
        .from("staff_profiles")
        .update({ full_name: form.fullName.trim() || null })
        .eq("user_id", userId),
    ]);
    if (ppRes.error || spRes.error) {
      setErr(ppRes.error?.message ?? spRes.error?.message ?? "Save failed");
      setSaving(false);
      return;
    }
    onSaved(form);
    onClose();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white text-base">Edit Profile</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={save} className="flex flex-col gap-4">
          {[
            { key: "companyName" as const, label: "Company Name", placeholder: "Your company" },
            { key: "fullName"    as const, label: "Full Name",    placeholder: "Your name" },
            { key: "phone"       as const, label: "Phone",        placeholder: "+61 4xx xxx xxx" },
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</label>
              <input
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors"
              />
            </div>
          ))}
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 h-10 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirmation dialog ─────────────────────────────────────────────

function DeleteConfirmDialog({
  onConfirm,
  onClose,
  deleting,
}: {
  onConfirm: () => void;
  onClose: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141414] p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-white text-base mb-1">Delete Account</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              This will permanently delete your account and all data. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={deleting}
            className="flex-1 h-10 rounded-lg border border-white/[0.08] text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={deleting}
            className="flex-1 h-10 rounded-lg bg-rose-600 text-sm font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50">
            {deleting ? "Deleting…" : "Delete Forever"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, promoterName, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [promoterProfile, setPromoterProfile] = useState<PromoterProfile | null>(null);
  const [staffProfile, setStaffProfile]       = useState<StaffProfile | null>(null);
  const [payRates, setPayRates]               = useState<PayRates | null>(null);
  const [eventCount, setEventCount]   = useState(0);
  const [vendorCount, setVendorCount] = useState(0);
  const [checkinCount, setCheckinCount] = useState(0);
  const [abn, setAbn]                       = useState("");
  const [abnVerified, setAbnVerified]       = useState(false);
  const [abnBusinessName, setAbnBusinessName] = useState<string | null>(null);
  const [gstRegistered, setGstRegistered]   = useState(false);
  const [verifyingAbn, setVerifyingAbn]     = useState(false);
  const [abnEditing, setAbnEditing]         = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [showEdit, setShowEdit]       = useState(false);
  const [showDelete, setShowDelete]   = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [loggingOut, setLoggingOut]   = useState(false);

  useEffect(() => {
    if (!user) return;

    async function load() {
      const supabase = createClient();
      try {
        const [ppRes, spRes, evRes, prRes] = await Promise.all([
          supabase.from("promoter_profiles").select("company_name, approval_status, phone, abn, abn_verified, abn_business_name, gst_registered").eq("user_id", user!.id).maybeSingle(),
          supabase.from("staff_profiles").select("full_name").eq("user_id", user!.id).maybeSingle(),
          supabase.from("events").select("id").eq("promoter_id", user!.id),
          supabase.from("pay_rates").select("base_rate, saturday_rate, public_holiday_rate").eq("vendor_id", user!.id).maybeSingle(),
        ]);

        if (ppRes.data) {
          const pp = ppRes.data as PromoterProfile;
          setPromoterProfile(pp);
          setAbn(pp.abn ?? "");
          setAbnVerified(pp.abn_verified === true);
          setAbnBusinessName(pp.abn_business_name ?? null);
          setGstRegistered(pp.gst_registered === true);
        }
        if (spRes.data) setStaffProfile(spRes.data as StaffProfile);
        if (prRes.data) setPayRates(prRes.data as PayRates);

        const eventIds = (evRes.data ?? []).map((e: { id: string }) => e.id);
        setEventCount(eventIds.length);

        if (eventIds.length > 0) {
          const [vendorRes, checkinRes] = await Promise.all([
            supabase.from("event_vendors").select("vendor_id").in("event_id", eventIds),
            supabase.from("event_checkins").select("user_id", { count: "exact", head: true }).in("event_id", eventIds),
          ]);
          const uniqueVendors = new Set((vendorRes.data ?? []).map((v: { vendor_id: string }) => v.vendor_id));
          setVendorCount(uniqueVendors.size);
          setCheckinCount(checkinRes.count ?? 0);
        }
      } finally {
        setDataLoading(false);
      }
    }

    load();
  }, [user?.id]);

  async function handleLogout() {
    setLoggingOut(true);
    await createClient().auth.signOut();
    router.replace("/login");
  }

  async function handleVerifyAbn() {
    setVerifyingAbn(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("validate-abn", {
        body: { abn: abn.replace(/\s/g, "") },
      });
      if (error || !data?.valid) {
        setAbnVerified(false);
        alert(data?.entityName || "ABN could not be verified.");
        return;
      }
      setAbnVerified(true);
      setAbnEditing(false);
      setAbnBusinessName(data.entityName);
      setGstRegistered(data.gst);
      // Save immediately
      await supabase.from("promoter_profiles").update({
        abn: abn.replace(/\s/g, ""),
        abn_verified: true,
        abn_business_name: data.entityName,
        gst_registered: data.gst,
      }).eq("user_id", user!.id);
    } finally {
      setVerifyingAbn(false);
    }
  }

  async function handleEditAbn() {
    setAbnEditing(true);
    setAbnVerified(false);
    await createClient()
      .from("promoter_profiles")
      .update({ abn_verified: false })
      .eq("user_id", user!.id);
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      await supabase.auth.signOut();
      router.replace("/login");
    } catch {
      setDeleting(false);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-zinc-500 text-sm">Loading…</span>
      </div>
    );
  }

  const displayFullName  = staffProfile?.full_name ?? promoterName ?? "—";
  const displayCompany   = promoterProfile?.company_name ?? null;
  const displayEmail     = user?.email ?? "";
  const displayPhone     = promoterProfile?.phone ?? null;
  const approvalStatus   = promoterProfile?.approval_status ?? null;

  const initials = (displayCompany ?? displayFullName).charAt(0).toUpperCase();

  const statusStyle: Record<string, React.CSSProperties> = {
    approved: { backgroundColor: "#00C896" + "1a", color: "#00C896", boxShadow: "inset 0 0 0 1px #00C89633" },
    pending:  { backgroundColor: "#FFD60A" + "1a", color: "#FFD60A", boxShadow: "inset 0 0 0 1px #FFD60A33" },
    rejected: { backgroundColor: "#E91E8C" + "1a", color: "#E91E8C", boxShadow: "inset 0 0 0 1px #E91E8C33" },
  };

  return (
    <>
      {showEdit && user && (
        <EditProfileModal
          userId={user.id}
          initial={{
            companyName: displayCompany ?? "",
            fullName:    displayFullName,
            phone:       displayPhone ?? "",
          }}
          onSaved={({ companyName, fullName, phone }) => {
            setPromoterProfile((p) => ({ ...p!, company_name: companyName || null, phone: phone || null }));
            setStaffProfile((p) => ({ ...p!, full_name: fullName || null }));
          }}
          onClose={() => setShowEdit(false)}
        />
      )}
      {showDelete && (
        <DeleteConfirmDialog
          onConfirm={handleDeleteAccount}
          onClose={() => setShowDelete(false)}
          deleting={deleting}
        />
      )}

      <div className="max-w-3xl mx-auto px-5 py-8">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-white" style={{ backgroundColor: "#5B4AE8" }}>
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{displayCompany ?? displayFullName}</h1>
            {displayCompany && (
              <p className="text-sm font-semibold mt-0.5" style={{ color: "#5B4AE8" }}>{displayFullName}</p>
            )}
            <p className="text-zinc-500 text-sm mt-0.5">{displayEmail}</p>
            {approvalStatus && (
              <span className="inline-block mt-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold" style={statusStyle[approvalStatus] ?? statusStyle.pending}>
                {approvalStatus.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Stats — 3 cards */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { label: "Events Created",  value: eventCount },
            { label: "Unique Vendors",  value: vendorCount },
            { label: "Total Check-ins", value: checkinCount },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center">
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>

        {/* Account */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Account</p>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            {[
              { label: "Company", value: displayCompany ?? "—" },
              { label: "Email",   value: displayEmail },
              { label: "Phone",   value: displayPhone ?? "—" },
              { label: "Role",    value: "Promoter" },
            ].map(({ label, value }, i, arr) => (
              <div key={label} className={`flex items-center justify-between px-5 py-3.5 ${i < arr.length - 1 ? "border-b border-white/[0.04]" : ""}`}>
                <span className="text-sm text-zinc-500">{label}</span>
                <span className="text-sm text-white font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ABN Verification */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">ABN Verification</p>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">ABN</label>
            {abnVerified && !abnEditing ? (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-sm text-white">
                  {abn}
                </span>
                <button
                  onClick={handleEditAbn}
                  className="px-3 py-2 text-sm rounded-lg border border-white/[0.08] text-zinc-300 hover:text-white hover:border-white/[0.16] transition-colors"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="flex gap-2 mt-1.5">
                <input
                  value={abn}
                  onChange={(e) => { setAbn(e.target.value); setAbnVerified(false); }}
                  placeholder="12 345 678 901"
                  className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500 transition-colors"
                />
                <button
                  onClick={handleVerifyAbn}
                  disabled={!abn || verifyingAbn}
                  className="px-3 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: "#5B4AE8" }}
                >
                  {verifyingAbn ? "Verifying…" : "Verify ABN"}
                </button>
              </div>
            )}
            <div className="mt-3">
              {abnVerified ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-900/40 text-green-400 border border-green-800">
                  ✓ Verified{abnBusinessName ? ` — ${abnBusinessName}` : ""}
                  <span className="text-green-500/70">· {gstRegistered ? "GST Registered" : "Not GST Registered"}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-800 text-gray-400">
                  Not verified
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Pay Rates */}
        <div className="mb-8">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Pay Rates</p>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            {payRates && (
              <>
                {[
                  { label: "Weekday",       value: payRates.base_rate },
                  { label: "Weekend",       value: payRates.saturday_rate },
                  { label: "Public Holiday", value: payRates.public_holiday_rate },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.04]">
                    <span className="text-sm text-zinc-500">{label}</span>
                    <span className="text-sm text-white font-medium">
                      {value != null ? `$${value.toFixed(2)}/hr` : "—"}
                    </span>
                  </div>
                ))}
              </>
            )}
            <Link href="/dashboard/profile/pay-rates" className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.04] transition-colors">
              <span className="text-sm text-white font-medium">
                {payRates ? "Edit Pay Rates" : "Configure Pay Rates"}
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Edit Profile */}
        <button
          onClick={() => setShowEdit(true)}
          className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 transition-colors mb-3"
        >
          Edit Profile
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full rounded-xl border border-white/[0.08] py-3 text-sm font-semibold text-zinc-300 hover:text-white hover:border-white/[0.16] transition-colors mb-3 disabled:opacity-40"
        >
          {loggingOut ? "Signing out…" : "Log Out"}
        </button>

        {/* Delete Account */}
        <button
          onClick={() => setShowDelete(true)}
          className="w-full rounded-xl border border-rose-500/20 py-3 text-sm font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          Delete Account
        </button>
      </div>
    </>
  );
}

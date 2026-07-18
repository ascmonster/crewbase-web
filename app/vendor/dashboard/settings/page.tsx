"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRequireVendorAuth } from "@/lib/useRequireVendorAuth";
import { createClient } from "@/lib/supabase";
import AwardSelector from "@/components/AwardSelector";
import AwardRateGuide from "@/components/AwardRateGuide";

// ── Types ──────────────────────────────────────────────────────────────────
// vendor_subscriptions and the `create-portal-session` edge function are still
// unverified/not-yet-created (see flags). Everything else uses confirmed columns.

type ProfileForm = {
  business_name: string;
  abn: string;
  suburb: string;
  state: string;
  phone: string;
  description: string;
};

type PayRatesForm = {
  base_rate: string;
  evening_rate: string;
  saturday_rate: string;
  sunday_rate: string;
  public_holiday_rate: string;
};

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

type Subscription = {
  status: string;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
} | null;

type Tab = "profile" | "subscription" | "payrates";

const APPROVAL_CFG: Record<string, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  pending:  { label: "Pending",  cls: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  rejected: { label: "Rejected", cls: "border-rose-500/30 bg-rose-500/10 text-rose-400" },
};

const SUB_STATUS_CFG: Record<string, string> = {
  active:    "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  cancelled: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
  past_due:  "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
};

function subStatusCls(s: string) {
  return SUB_STATUS_CFG[s.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20";
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
    : (name.charAt(0) || "V").toUpperCase();
}

// ── Atoms ──────────────────────────────────────────────────────────────────

function SkeletonBlock() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-white/[0.03] animate-pulse" />)}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors"
      />
    </div>
  );
}

function RateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label} ($/hr)</label>
      <input
        type="number" min="0" step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors [appearance:textfield]"
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function VendorSettingsPage() {
  const { user, loading: authLoading } = useRequireVendorAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  // Profile
  const [form, setForm] = useState<ProfileForm>({ business_name: "", abn: "", suburb: "", state: "", phone: "", description: "" });
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [toast, setToast] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [squareConnected, setSquareConnected] = useState(false);
  const [squareMerchantName, setSquareMerchantName] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [abnVerified, setAbnVerified] = useState(false);
  const [abnBusinessName, setAbnBusinessName] = useState<string | null>(null);
  const [gstRegistered, setGstRegistered] = useState(false);
  const [verifyingAbn, setVerifyingAbn] = useState(false);
  const [abnEditing, setAbnEditing] = useState(false);

  // Subscription
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [subLoaded, setSubLoaded] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  // Pay rates (single row)
  const [rates, setRates] = useState<PayRatesForm>({ base_rate: "", evening_rate: "", saturday_rate: "", sunday_rate: "", public_holiday_rate: "" });
  const [awardCode, setAwardCode] = useState<string | null>(null);
  const [employmentType, setEmploymentType] = useState<EmploymentType>("casual");
  const [ratesLoaded, setRatesLoaded] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [savingRates, setSavingRates] = useState(false);

  // FWC penalty-rate breakdown preference (vendor_profiles.show_penalty_rates)
  const [showPenaltyRates, setShowPenaltyRates] = useState(false);

  function showToast() {
    setToast(true);
    setTimeout(() => setToast(false), 2500);
  }

  // ── Profile load ──
  useEffect(() => {
    if (!user) return;
    async function load() {
      setProfileLoading(true);
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data } = await createClient()
        .from("vendor_profiles")
        .select("business_name, abn, suburb, state, phone, description, approval_status, logo_url, onboarding_complete, square_connected, square_merchant_name, phone_verified, abn_verified, abn_business_name, gst_registered, show_penalty_rates")
        .eq("user_id", user!.id)
        .maybeSingle();
      const p = (data ?? {}) as any;
      setForm({
        business_name: p.business_name ?? "",
        abn: p.abn ?? "",
        suburb: p.suburb ?? "",
        state: p.state ?? "",
        phone: p.phone ?? "",
        description: p.description ?? "",
      });
      setApprovalStatus(p.approval_status ?? null);
      setLogoUrl(p.logo_url ?? null);
      setOnboardingComplete(!!p.onboarding_complete);
      setSquareConnected(p.square_connected === true);
      setSquareMerchantName(p.square_merchant_name ?? null);
      setPhoneVerified(p.phone_verified === true);
      setAbnVerified(p.abn_verified === true);
      setAbnBusinessName(p.abn_business_name ?? null);
      setGstRegistered(p.gst_registered === true);
      setShowPenaltyRates(p.show_penalty_rates === true);
      /* eslint-enable @typescript-eslint/no-explicit-any */
      setProfileLoading(false);
    }
    load();
  }, [user?.id]);

  // ── Subscription lazy load ──
  useEffect(() => {
    if (activeTab !== "subscription" || subLoaded || !user) return;
    async function load() {
      setSubLoading(true);
      const { data } = await createClient()
        .from("vendor_subscriptions")
        .select("status, current_period_end, stripe_subscription_id, stripe_customer_id")
        .eq("vendor_id", user!.id)
        .maybeSingle();
      const s = data as Subscription;
      setSubscription(s ? {
        status: s.status ?? "active",
        current_period_end: s.current_period_end ?? null,
        stripe_subscription_id: s.stripe_subscription_id ?? null,
        stripe_customer_id: s.stripe_customer_id ?? null,
      } : null);
      setSubLoaded(true);
      setSubLoading(false);
    }
    load();
  }, [activeTab, subLoaded, user?.id]);

  // ── Pay rates lazy load ──
  useEffect(() => {
    if (activeTab !== "payrates" || ratesLoaded || !user) return;
    async function load() {
      setRatesLoading(true);
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data } = await createClient()
        .from("pay_rates")
        .select("base_rate, evening_rate, saturday_rate, sunday_rate, public_holiday_rate, award_code, employment_type")
        .eq("vendor_id", user!.id)
        .maybeSingle();
      const r = (data ?? {}) as any;
      const str = (v: any) => (v == null ? "" : String(v));
      setRates({
        base_rate: str(r.base_rate),
        evening_rate: str(r.evening_rate),
        saturday_rate: str(r.saturday_rate),
        sunday_rate: str(r.sunday_rate),
        public_holiday_rate: str(r.public_holiday_rate),
      });
      setAwardCode(r.award_code ?? null);
      setEmploymentType(empFromDb(r.employment_type));
      /* eslint-enable @typescript-eslint/no-explicit-any */
      setRatesLoaded(true);
      setRatesLoading(false);
    }
    load();
  }, [activeTab, ratesLoaded, user?.id]);

  async function saveProfile() {
    setSaving(true);
    await createClient()
      .from("vendor_profiles")
      .update({
        business_name: form.business_name.trim(),
        abn: form.abn.trim() || null,
        suburb: form.suburb.trim() || null,
        state: form.state.trim() || null,
        phone: form.phone.trim() || null,
        description: form.description.trim() || null,
        onboarding_complete: onboardingComplete,
      })
      .eq("user_id", user!.id);
    setSaving(false);
    showToast();
  }

  async function handleVerifyAbn() {
    setVerifyingAbn(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("validate-abn", {
        body: { abn: form.abn.replace(/\s/g, "") },
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
      await supabase.from("vendor_profiles").update({
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
      .from("vendor_profiles")
      .update({ abn_verified: false })
      .eq("user_id", user!.id);
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    const supabase = createClient();
    const path = `${user!.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (!upErr) {
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl;
      await supabase.from("vendor_profiles").update({ logo_url: url }).eq("user_id", user!.id);
      setLogoUrl(url);
    }
    setUploadingLogo(false);
  }

  async function savePayRates() {
    setSavingRates(true);
    const num = (v: string) => (v.trim() === "" ? null : parseFloat(v));
    await createClient()
      .from("pay_rates")
      .upsert(
        {
          vendor_id: user!.id,
          base_rate: num(rates.base_rate),
          evening_rate: num(rates.evening_rate),
          saturday_rate: num(rates.saturday_rate),
          sunday_rate: num(rates.sunday_rate),
          public_holiday_rate: num(rates.public_holiday_rate),
          award_code: awardCode,
          employment_type: EMP_TO_DB[employmentType],
        },
        { onConflict: "vendor_id" }
      );
    setSavingRates(false);
    showToast();
  }

  async function toggleShowPenaltyRates() {
    const next = !showPenaltyRates;
    setShowPenaltyRates(next);
    await createClient()
      .from("vendor_profiles")
      .update({ show_penalty_rates: next })
      .eq("user_id", user!.id);
  }

  async function openPortal() {
    setPortalBusy(true);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-portal-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ stripe_customer_id: subscription?.stripe_customer_id ?? null }),
      });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
    } finally {
      setPortalBusy(false);
    }
  }

  async function disconnectSquare() {
    await createClient()
      .from("vendor_profiles")
      .update({ square_connected: false, square_access_token: null, square_merchant_id: null })
      .eq("user_id", user!.id);
    setSquareConnected(false);
    setSquareMerchantName(null);
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  const approvalCfg = approvalStatus ? APPROVAL_CFG[approvalStatus.toLowerCase()] : null;

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <h1 className="text-xl font-bold text-white mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-white/[0.06]">
        {([["profile", "Profile"], ["subscription", "Subscription"], ["payrates", "Pay Rates"]] as [Tab, string][]).map(([key, label]) => (
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

      {/* ── Profile ── */}
      {activeTab === "profile" && (
        authLoading || profileLoading ? (
          <SkeletonBlock />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Logo + approval */}
            <div className="flex items-center gap-4">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-[#FF6B35]/15 text-[#FF6B35] flex items-center justify-center text-xl font-bold shrink-0">
                  {initials(form.business_name || "Vendor")}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className={`cursor-pointer rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors ${uploadingLogo ? "opacity-50 pointer-events-none" : ""}`}>
                  {uploadingLogo ? "Uploading…" : "Upload Logo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
                </label>
                {approvalCfg && (
                  <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${approvalCfg.cls}`}>
                    {approvalCfg.label}
                  </span>
                )}
              </div>
            </div>

            <Field label="Business Name" value={form.business_name} onChange={(v) => setForm((p) => ({ ...p, business_name: v }))} />

            {/* ABN + verification */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">ABN</label>
              {abnVerified && !abnEditing ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-sm text-white">
                    {form.abn}
                  </span>
                  <button
                    onClick={handleEditAbn}
                    className="px-3 py-2 text-sm rounded-lg border border-white/[0.08] text-zinc-300 hover:text-white hover:border-white/[0.16] transition-colors"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={form.abn}
                    onChange={(e) => { setForm((p) => ({ ...p, abn: e.target.value })); setAbnVerified(false); }}
                    placeholder="12 345 678 901"
                    className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors"
                  />
                  <button
                    onClick={handleVerifyAbn}
                    disabled={!form.abn || verifyingAbn}
                    className="px-3 py-2 text-sm bg-[#5B4AE8] text-white rounded-lg hover:bg-[#4a3bd0] disabled:opacity-50"
                  >
                    {verifyingAbn ? "Verifying..." : "Verify ABN"}
                  </button>
                </div>
              )}
              {abnVerified && abnBusinessName && (
                <p className="text-sm text-green-400 mt-1">✓ Verified — {abnBusinessName} {gstRegistered ? "· GST Registered" : "· Not GST Registered"}</p>
              )}
              {form.abn && !abnVerified && (
                <p className="text-sm text-amber-400 mt-1">⚠ ABN not verified</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Suburb" value={form.suburb} onChange={(v) => setForm((p) => ({ ...p, suburb: v }))} />
              <Field label="State" value={form.state} onChange={(v) => setForm((p) => ({ ...p, state: v }))} />
            </div>
            <Field label="Phone" value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Business Description</label>
              <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#FF6B35] transition-colors resize-none" />
            </div>

            {/* Onboarding complete toggle */}
            <button
              type="button"
              onClick={() => setOnboardingComplete((v) => !v)}
              className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3"
            >
              <div className="text-left">
                <p className="text-sm font-medium text-white">Onboarding Complete</p>
                <p className="text-xs text-zinc-500">Mark your vendor setup as finished.</p>
              </div>
              <span className={`relative w-11 h-6 rounded-full transition-colors ${onboardingComplete ? "bg-[#FF6B35]" : "bg-white/[0.12]"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${onboardingComplete ? "translate-x-5" : ""}`} />
              </span>
            </button>

            <button onClick={saveProfile} disabled={saving} className="self-start rounded-lg bg-[#FF6B35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {saving ? "Saving…" : "Save Changes"}
            </button>

            {/* Identity Verification */}
            <div className="bg-[#111] rounded-xl p-6 border border-white/5 mt-2">
              <h2 className="text-white font-semibold text-lg mb-4">Identity Verification</h2>

              {/* Phone Verification */}
              <div className="flex items-center justify-between py-3 border-b border-white/5">
                <div>
                  <p className="text-white text-sm font-medium">Phone Verification</p>
                  <p className="text-gray-400 text-xs mt-0.5">Mobile number verified via SMS</p>
                </div>
                {phoneVerified ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-900/40 text-blue-400 border border-blue-800">
                    📞 Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-800 text-gray-400">
                    Not Verified
                  </span>
                )}
              </div>

              {/* ABN Verification */}
              <div className="flex items-center justify-between py-3 border-b border-white/5">
                <div>
                  <p className="text-white text-sm font-medium">ABN Verification</p>
                  <p className="text-gray-400 text-xs mt-0.5">Australian Business Number verified</p>
                </div>
                {abnVerified ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-900/40 text-green-400 border border-green-800">
                    ✓ Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-800 text-gray-400">
                    Not Verified
                  </span>
                )}
              </div>

              {/* Account Approval */}
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="text-white text-sm font-medium">Account Status</p>
                  <p className="text-gray-400 text-xs mt-0.5">Reviewed by Crewbase team</p>
                </div>
                {approvalStatus === "approved" ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-900/40 text-green-400 border border-green-800">
                    ✓ Approved
                  </span>
                ) : approvalStatus === "rejected" ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-900/40 text-red-400 border border-red-800">
                    ✗ Rejected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-900/40 text-amber-400 border border-amber-800">
                    ⏳ Pending
                  </span>
                )}
              </div>
            </div>

            {/* Square Payments */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] border-l-4 border-l-[#FF6B35] px-5 py-5 mt-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Square Payments</p>
              <div className="flex items-center gap-2 mb-4">
                <span className={`w-2.5 h-2.5 rounded-full ${squareConnected ? "bg-emerald-400" : "bg-zinc-500"}`} />
                <span className={`text-sm font-medium ${squareConnected ? "text-emerald-400" : "text-zinc-400"}`}>
                  {squareConnected ? `Square Connected ✓${squareMerchantName ? ` — ${squareMerchantName}` : ""}` : "Not Connected"}
                </span>
              </div>
              {squareConnected ? (
                <div className="flex flex-wrap gap-3">
                  <Link href="/vendor/dashboard/analytics" className="rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-4 py-2 text-sm font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors">
                    View Revenue Dashboard
                  </Link>
                  <button onClick={disconnectSquare} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors">
                    Disconnect
                  </button>
                </div>
              ) : (
                <a href={`/api/square/connect?type=vendor&user_id=${user!.id}`} className="block w-full text-center rounded-lg bg-[#FF6B35] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors">
                  Connect Square
                </a>
              )}
            </div>

            {/* Account */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 mt-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Account</p>
              <div className="flex items-center justify-between py-2 border-b border-white/[0.05]">
                <span className="text-sm text-zinc-500">Email</span>
                <span className="text-sm text-white truncate ml-3">{user!.email || "—"}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-zinc-500">Role</span>
                <span className="text-sm text-white">Vendor</span>
              </div>
            </div>

            {/* Sign out */}
            <button onClick={signOut} className="self-stretch rounded-lg border border-white/[0.08] px-5 py-2.5 text-sm font-semibold text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors mt-2">
              Sign Out
            </button>
          </div>
        )
      )}

      {/* ── Subscription ── */}
      {activeTab === "subscription" && (
        authLoading || subLoading ? (
          <SkeletonBlock />
        ) : !subscription ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 flex flex-col items-center gap-3 text-center">
            <div className="text-zinc-600">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <p className="text-zinc-400 font-medium">No active subscription</p>
            <p className="text-zinc-600 text-sm max-w-xs">Subscribe to unlock premium vendor features.</p>
            <button onClick={openPortal} disabled={portalBusy} className="mt-2 rounded-lg bg-[#FF6B35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {portalBusy ? "Opening…" : "Subscribe"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Current Plan</p>
                  <p className="text-lg font-bold text-white">Active Plan</p>
                  {subscription.stripe_subscription_id && (
                    <p className="text-xs text-zinc-600 mt-0.5 truncate">{subscription.stripe_subscription_id}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${subStatusCls(subscription.status)}`}>
                  {subscription.status.replace("_", " ").toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-zinc-500">Next billing date: <span className="text-zinc-300">{fmtDate(subscription.current_period_end)}</span></p>
            </div>
            <button onClick={openPortal} disabled={portalBusy} className="self-start rounded-lg border border-[#FF6B35]/40 bg-[#FF6B35]/10 px-5 py-2.5 text-sm font-semibold text-[#FF6B35] hover:bg-[#FF6B35]/20 transition-colors disabled:opacity-50">
              {portalBusy ? "Opening…" : "Manage Subscription"}
            </button>
          </div>
        )
      )}

      {/* ── Pay Rates ── */}
      {activeTab === "payrates" && (
        authLoading || ratesLoading ? (
          <SkeletonBlock />
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-xs text-zinc-500">Set the hourly rates applied to your staff&apos;s shifts.</p>

            {/* Award selection */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Modern Award</label>
              <AwardSelector value={awardCode} onChange={setAwardCode} accent="orange" />
            </div>

            {/* Show penalty rate breakdowns */}
            <button
              type="button"
              onClick={toggleShowPenaltyRates}
              className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3"
            >
              <div className="text-left">
                <p className="text-sm font-medium text-white">Show Penalty Rate Breakdowns</p>
                <p className="text-xs text-zinc-500">Display casual/permanent penalty rates in FWC guidelines.</p>
              </div>
              <span className={`relative w-11 h-6 rounded-full transition-colors ${showPenaltyRates ? "bg-[#FF6B35]" : "bg-white/[0.12]"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${showPenaltyRates ? "translate-x-5" : ""}`} />
              </span>
            </button>

            {/* Default employment type — persisted to pay_rates.employment_type */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Default Employment Type</label>
              <div className="flex items-center gap-1.5">
                {EMPLOYMENT_TYPE_OPTIONS.map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setEmploymentType(val)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      employmentType === val ? "bg-[#FF6B35] text-white" : "border border-white/[0.12] text-zinc-400 hover:text-white"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <RateField label="Base Rate" value={rates.base_rate} onChange={(v) => setRates((p) => ({ ...p, base_rate: v }))} />
              <RateField label="Evening Rate" value={rates.evening_rate} onChange={(v) => setRates((p) => ({ ...p, evening_rate: v }))} />
              <RateField label="Saturday Rate" value={rates.saturday_rate} onChange={(v) => setRates((p) => ({ ...p, saturday_rate: v }))} />
              <RateField label="Sunday Rate" value={rates.sunday_rate} onChange={(v) => setRates((p) => ({ ...p, sunday_rate: v }))} />
              <RateField label="Public Holiday Rate" value={rates.public_holiday_rate} onChange={(v) => setRates((p) => ({ ...p, public_holiday_rate: v }))} />
            </div>

            {/* FWC guideline for the selected award + entered base rate */}
            <AwardRateGuide
              awardCode={awardCode}
              enteredRate={rates.base_rate.trim() === "" ? null : parseFloat(rates.base_rate)}
              showPenaltyRates={showPenaltyRates}
              employmentType={employmentType}
              accent="orange"
            />

            <button onClick={savePayRates} disabled={savingRates} className="self-start rounded-lg bg-[#FF6B35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7d4d] transition-colors disabled:opacity-50">
              {savingRates ? "Saving…" : "Save Pay Rates"}
            </button>
          </div>
        )
      )}

      {/* Success toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400 shadow-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Settings saved
        </div>
      )}
    </div>
  );
}

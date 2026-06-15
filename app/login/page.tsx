"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase";

type Stage = "form" | "pending" | "rejected";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("form");

  async function handleSignOut() {
    await createClient().auth.signOut();
    setStage("form");
    setError(null);
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Authentication failed. Please try again.");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      setError("Could not retrieve account information. Please contact support.");
      setLoading(false);
      return;
    }

    if (profile.role !== "promoter" && profile.role !== "admin") {
      await supabase.auth.signOut();
      setError("This portal is for promoters only.");
      setLoading(false);
      return;
    }

    const { data: promoterProfile } = await supabase
      .from("promoter_profiles")
      .select("approval_status")
      .eq("user_id", user.id)
      .single();

    const approvalStatus = promoterProfile?.approval_status;

    if (approvalStatus === "pending") {
      setStage("pending");
      setLoading(false);
      return;
    }

    if (approvalStatus === "rejected") {
      setStage("rejected");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  if (stage === "pending") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <div className="flex justify-center mb-2">
              <Image src="/logo-icon.png" alt="Crewbase" width={80} height={80} style={{ objectFit: "contain" }} />
            </div>
            <span className="text-3xl font-bold tracking-tight text-white">
              Crew<span className="text-indigo-400">base</span>
            </span>
            <p className="mt-2 text-sm text-zinc-500">Promoter portal</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-8 py-10 shadow-xl shadow-black/40 text-center">
            <div className="mb-4 flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FFD60A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white mb-3">Account Under Review</h2>
            <p className="text-sm text-zinc-400 mb-6">
              Your account is under review. We&apos;ll notify you by email once approved — usually within 24 hours.
            </p>
            <button
              onClick={handleSignOut}
              className="w-full h-10 rounded-lg border border-white/[0.08] text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "rejected") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <div className="flex justify-center mb-2">
              <Image src="/logo-icon.png" alt="Crewbase" width={80} height={80} style={{ objectFit: "contain" }} />
            </div>
            <span className="text-3xl font-bold tracking-tight text-white">
              Crew<span className="text-indigo-400">base</span>
            </span>
            <p className="mt-2 text-sm text-zinc-500">Promoter portal</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-8 py-10 shadow-xl shadow-black/40 text-center">
            <div className="mb-4 flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E91E8C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white mb-3">Application Not Approved</h2>
            <p className="text-sm text-zinc-400 mb-6">
              Contact{" "}
              <a href="mailto:hello@trycrewbase.com" className="text-indigo-400 hover:underline">
                hello@trycrewbase.com
              </a>
            </p>
            <button
              onClick={handleSignOut}
              className="w-full h-10 rounded-lg border border-white/[0.08] text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="flex justify-center mb-2">
            <Image src="/logo-icon.png" alt="Crewbase" width={80} height={80} style={{ objectFit: "contain" }} />
          </div>
          <span className="text-3xl font-bold tracking-tight text-white">
            Crew<span className="text-indigo-400">base</span>
          </span>
          <p className="mt-2 text-sm text-zinc-500">Promoter portal</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-8 py-10 shadow-xl shadow-black/40">
          <h1 className="mb-6 text-lg font-semibold text-white">Sign in</h1>

          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-xs font-medium text-zinc-400 uppercase tracking-wider"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                className="text-xs font-medium text-zinc-400 uppercase tracking-wider"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-10 w-full items-center justify-center rounded-lg bg-indigo-600 text-sm font-medium text-white transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

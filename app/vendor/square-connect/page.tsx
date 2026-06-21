"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type PageState = "loading" | "valid" | "invalid" | "success" | "error";

const SQUARE_CLIENT_ID = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.trycrewbase.com";
const isSandbox = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production";

export default function VendorSquareConnectPage() {
  const [state, setState] = useState<PageState>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Handle success redirect from vendor-callback
    if (params.get("success") === "true") {
      setState("success");
      return;
    }

    // Handle error redirect from vendor-callback
    const err = params.get("error");
    if (err) {
      if (err === "invalid_token" || err === "token_used") {
        setState("invalid");
      } else {
        setErrorMsg(decodeURIComponent(err));
        setState("error");
      }
      return;
    }

    const t = params.get("token");
    if (!t) {
      setState("invalid");
      return;
    }

    // Validate the token against vendor_square_invites
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vendor_square_invites")
        .select("id, used")
        .eq("token", t)
        .maybeSingle();

      if (error || !data || data.used) {
        setState("invalid");
      } else {
        setToken(t);
        setState("valid");
      }
    })();
  }, []);

  function handleConnect() {
    if (!token) return;
    const baseUrl = isSandbox
      ? "https://connect.squareupsandbox.com/oauth2/authorize"
      : "https://connect.squareup.com/oauth2/authorize";
    const redirectUri = `${APP_URL}/api/square/vendor-callback`;
    const scopes = "MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE";
    const url =
      `${baseUrl}?client_id=${SQUARE_CLIENT_ID}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(token)}`;
    window.location.href = url;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 text-center">
          <p className="text-xl font-bold tracking-tight text-white">Crewbase</p>
        </div>

        {state === "loading" && (
          <div className="text-center text-sm text-zinc-500">Verifying invite…</div>
        )}

        {state === "invalid" && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-10 text-center">
            <p className="text-2xl mb-3">🔗</p>
            <p className="text-sm font-semibold text-white mb-2">Invalid invite link</p>
            <p className="text-xs text-zinc-500">This invite link is invalid or has already been used.</p>
          </div>
        )}

        {state === "error" && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-10 text-center">
            <p className="text-sm font-semibold text-white mb-2">Something went wrong</p>
            <p className="text-xs text-zinc-500">{errorMsg ?? "An unexpected error occurred."}</p>
          </div>
        )}

        {state === "valid" && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-8 flex flex-col gap-5">
            <div className="text-center">
              <p className="text-lg font-bold text-white mb-2">Connect your Square account</p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Connecting your Square account allows Crewbase to automatically process your payments and split revenue at events.
              </p>
            </div>
            <button
              onClick={handleConnect}
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black transition-colors hover:bg-amber-400"
            >
              Connect Square
            </button>
          </div>
        )}

        {state === "success" && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-10 flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-white mb-1">Square account connected successfully!</p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                You&apos;re all set. Your payments will be automatically processed at the event.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

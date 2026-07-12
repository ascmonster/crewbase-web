"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "./supabase";

export type AuthUser = { id: string; email: string };

export function useRequireAuth() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [promoterName, setPromoterName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 5-second fallback — if auth never resolves, redirect rather than hang forever
    const timeout = setTimeout(() => {
      router.replace("/login");
    }, 5000);

    async function check() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          router.replace("/login");
          return;
        }

        const u = session.user;

        // Re-check approval on every load — a session created before the account
        // was suspended/rejected must be kicked out of the portal.
        const { data: promoterProfile } = await supabase
          .from("promoter_profiles")
          .select("approval_status")
          .eq("user_id", u.id)
          .maybeSingle();

        if (promoterProfile?.approval_status && ["pending", "rejected", "suspended"].includes(promoterProfile.approval_status)) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        setUser({ id: u.id, email: u.email ?? "" });

        const { data } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", u.id)
          .single();

        setPromoterName(data?.full_name ?? u.email ?? "Promoter");
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    }

    check();

    return () => clearTimeout(timeout);
  }, [router]);

  return { user, promoterName, loading };
}

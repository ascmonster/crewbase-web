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

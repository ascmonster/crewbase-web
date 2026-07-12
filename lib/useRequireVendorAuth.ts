"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "./supabase";

export type VendorAuthUser = { id: string; email: string };

export function useRequireVendorAuth() {
  const router = useRouter();
  const [user, setUser] = useState<VendorAuthUser | null>(null);
  const [businessName, setBusinessName] = useState("");
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

        const { data: profile } = await supabase
          .from("users")
          .select("role")
          .eq("id", u.id)
          .single();

        if (profile?.role !== "vendor") {
          router.replace("/login");
          return;
        }

        const { data: vendor } = await supabase
          .from("vendor_profiles")
          .select("business_name, approval_status")
          .eq("user_id", u.id)
          .single();

        // Re-check approval on every load — a session created before the account
        // was suspended/rejected must be kicked out of the portal.
        if (vendor?.approval_status && ["pending", "rejected", "suspended"].includes(vendor.approval_status)) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        setUser({ id: u.id, email: u.email ?? "" });
        setBusinessName(vendor?.business_name ?? u.email ?? "Vendor");
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    }

    check();

    return () => clearTimeout(timeout);
  }, [router]);

  return { user, businessName, loading };
}

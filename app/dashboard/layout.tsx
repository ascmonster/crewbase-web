"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function UsersIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PersonIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: HomeIcon, exact: true },
  { href: "/dashboard/team", label: "Team", Icon: UsersIcon, exact: false },
  { href: "/dashboard/profile", label: "Profile", Icon: PersonIcon, exact: false },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.from('push_tokens').delete().eq('user_id', (await supabase.auth.getUser()).data.user?.id);
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-white/[0.06]">
        <div className="h-14 px-5 flex items-center gap-2.5 border-b border-white/[0.06] shrink-0">
          <Image src="/logo-icon.png" alt="" width={28} height={28} style={{ objectFit: "contain" }} />
          <span className="text-base font-bold tracking-tight">
            Crew<span className="text-indigo-400">base</span>
          </span>
        </div>

        <nav className="flex-1 px-3 py-3 flex flex-col gap-0.5 overflow-y-auto">
          {NAV.map(({ href, label, Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <Icon active={active} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-white/[0.06] shrink-0">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <SignOutIcon />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="pb-20 lg:pb-0">{children}</div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 border-t border-white/[0.06] bg-[#0a0a0a] flex z-20">
        {NAV.map(({ href, label, Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                active ? "text-white" : "text-zinc-500"
              }`}
            >
              <Icon active={active} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

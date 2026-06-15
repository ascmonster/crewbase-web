"use client";

import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";

const MENU = [
  {
    href: "/dashboard/team/staff",
    label: "My Staff",
    sub: "View and manage your staff roster",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/team/schedule",
    label: "Schedule",
    sub: "Manage weekly staff rosters",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/team/timesheets",
    label: "Timesheets",
    sub: "Review, approve and pay completed shifts",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/team/applications",
    label: "Applications",
    sub: "Review and accept staff applications",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/team/applications",
    label: "Post a Job",
    sub: "Create a new job listing for staff",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/team/analytics",
    label: "Analytics",
    sub: "Attendance, shifts and performance insights",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/team/payroll",
    label: "Payroll Export",
    sub: null,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
    ),
  },
];

export default function TeamPage() {
  const { loading } = useRequireAuth();

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <h1 className="text-xl font-bold mb-6">Team</h1>

      <div className="flex flex-col gap-2">
        {MENU.map(({ href, label, sub, icon }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 hover:border-violet-500/30 hover:bg-white/[0.04] transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl bg-violet-600/10 text-violet-400 flex items-center justify-center shrink-0 group-hover:bg-violet-600/20 transition-colors">
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm">{label}</p>
              {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}

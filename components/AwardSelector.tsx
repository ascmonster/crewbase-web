"use client";

import { useEffect, useState } from "react";
import { RECOMMENDED_AWARDS, getAllAwards, type AwardOption } from "@/lib/getAwardRates";

/**
 * Native <select> for choosing a Modern Award. The 5 pinned event awards appear
 * first under "Recommended for Events"; every other award follows alphabetically
 * under "All Awards".
 *
 * `accent` swaps the focus ring so the control matches each portal (orange for
 * vendor, violet for promoter).
 */
export default function AwardSelector({
  value,
  onChange,
  accent = "orange",
  className = "",
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  accent?: "orange" | "violet";
  className?: string;
}) {
  const [all, setAll] = useState<AwardOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    getAllAwards().then((rows) => { if (!cancelled) setAll(rows); });
    return () => { cancelled = true; };
  }, []);

  const recommendedCodes = new Set(RECOMMENDED_AWARDS.map((a) => a.code));
  const rest = all.filter((a) => !recommendedCodes.has(a.code));

  const focus = accent === "violet" ? "focus:border-violet-500" : "focus:border-[#FF6B35]";

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`w-full rounded-lg border border-white/[0.08] bg-[#141414] px-3.5 py-2.5 text-sm text-white outline-none transition-colors [color-scheme:dark] ${focus} ${className}`}
    >
      <option value="">Select an award…</option>
      <optgroup label="Recommended for Events">
        {RECOMMENDED_AWARDS.map((a) => (
          <option key={a.code} value={a.code}>
            {a.name} ({a.code})
          </option>
        ))}
      </optgroup>
      {rest.length > 0 && (
        <optgroup label="All Awards">
          {rest.map((a) => (
            <option key={a.code} value={a.code}>
              {a.name} ({a.code})
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase/client";
import { C, SHADOW } from "./soft";

/**
 * The bell in every startsida's top bar, with the unread count on it.
 *
 * It replaces the notice cards the arbetare startsida used to draw, one per
 * unread notification -- for some workers 249 of them. A count says how much
 * is waiting without making anybody scroll past it; the list is one tap away
 * on /notiser. All three roles get it: until now a leader's and an admin's
 * notifications were drawn nowhere.
 *
 * Counted with head:true -- the number, not the rows. Above 99 it reads
 * "99+", which is what a badge has room for.
 */
export function NotisBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { count } = await getSupabase()
        .from("my_notification")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (live) setUnread(count ?? 0);
    })();
    return () => { live = false; };
  }, []);

  const label = unread === 0 ? "Notiser" : `Notiser, ${unread} olästa`;
  return (
    <Link
      href="/notiser"
      aria-label={label}
      data-notis-bell={unread}
      className="press-scale relative flex h-11 w-11 items-center justify-center rounded-[11px] p-0 transition-transform duration-[120ms] hover:bg-[#f4f3f0] active:scale-[.985] active:bg-[#e9e8e4]"
      style={{ background: C.surface, boxShadow: SHADOW.flat }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M5 8.2a5 5 0 0 1 10 0c0 4.3 1.6 5.6 1.6 5.6H3.4S5 12.5 5 8.2Z"
          stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
        <path d="M8.2 16.6a1.9 1.9 0 0 0 3.6 0" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
      </svg>
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-[5px] -top-[5px] flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-[5px] text-[12px] font-extrabold tabular-nums"
          style={{ background: C.accent, color: C.onAccent, boxShadow: `0 0 0 2px ${C.ground}` }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/supabase/auth";
import { getSupabase } from "@/lib/supabase/client";
import {
  automatedWithoutOptIn, elementOf, flush, record, screenOf, setAnalyticsToken,
} from "@/lib/analytics";

const px = (v: number) => Math.max(0, Math.min(32767, Math.round(v)));

/**
 * Records screen visits and taps for the operator's analytics. Draws nothing.
 *
 * A VISIT is one stretch of a screen being in front of somebody: it starts on
 * arriving or on the app coming back into view, and ends on leaving or on the
 * app being hidden. A phone locked in a jacket pocket on site is not eight
 * hours on the startsida, so hiding counts as leaving; coming back is a new
 * visit to the same screen.
 *
 * Decided once per account: an active account, a person rather than a test
 * browser, and not the operator -- by the flag on their own account row or by
 * standing inside somebody else's tenancy. The database refuses the operator
 * anyway (migration 20260929100000); checking here only saves sending rows
 * that would be refused.
 */
export function AnalyticsTracker() {
  const { account, loading } = useAccount();
  const { session } = useAuth();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState<string | null>(null);

  useEffect(() => {
    setAnalyticsToken(session?.access_token ?? null);
  }, [session]);

  useEffect(() => {
    if (loading || !account?.active || automatedWithoutOptIn()) return;
    let live = true;
    void (async () => {
      try {
        const sb = getSupabase();
        const [{ data: me }, { data: acting }] = await Promise.all([
          sb.from("account").select("super_admin").eq("id", account.id).maybeSingle(),
          sb.rpc("acting_tenant"),
        ]);
        if (!live || me?.super_admin || (Array.isArray(acting) && acting.length > 0)) return;
        setAllowed(account.id);
      } catch { /* no analytics is the safe answer */ }
    })();
    return () => { live = false; };
  }, [account, loading]);

  const role = allowed !== null && account?.id === allowed ? account.role : null;

  useEffect(() => {
    const screen = screenOf(pathname);
    if (!role || !screen) return;

    let visit: { id: string; since: number } | null = null;

    const enter = () => {
      visit = { id: crypto.randomUUID(), since: performance.now() };
      record({
        role, kind: "screen_enter", screen, visit_id: visit.id,
        client_at: new Date().toISOString(),
      });
    };
    const exit = (leaving: boolean) => {
      if (!visit) return;
      record({
        role, kind: "screen_exit", screen, visit_id: visit.id,
        client_at: new Date().toISOString(),
        duration_ms: Math.min(86_400_000, Math.round(performance.now() - visit.since)),
      });
      visit = null;
      if (leaving) void flush(true);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") exit(true);
      else if (!visit) enter();
    };
    const onPageHide = () => exit(true);
    // Capture phase, and nothing is stopped: the tap is the person's. A click
    // with detail 0 came from a keyboard or a script, and has no position.
    const onTap = (e: MouseEvent) => {
      if (!visit || e.detail === 0) return;
      record({
        role, kind: "tap", screen, visit_id: visit.id,
        client_at: new Date().toISOString(),
        element: elementOf(e.target),
        x: px(e.clientX), y: px(e.clientY),
        vw: Math.max(1, px(window.innerWidth)), vh: Math.max(1, px(window.innerHeight)),
        scroll_y: Math.max(0, Math.round(window.scrollY)),
      });
    };

    if (document.visibilityState === "visible") enter();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("click", onTap, true);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("click", onTap, true);
      exit(false);
    };
  }, [role, pathname]);

  return null;
}

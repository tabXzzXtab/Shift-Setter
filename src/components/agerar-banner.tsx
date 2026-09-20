"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";

/** Where the chosen role is kept. See the note on ROLE below. */
export const ACTING_ROLE_KEY = "byggkoll.agerar-roll";

export type ActingRole = "admin" | "arbetsledare" | "arbetare";

export const HOME_FOR: Record<ActingRole, string> = {
  admin: "/",
  arbetsledare: "/",
  arbetare: "/",
};

const ROLE_WORD: Record<ActingRole, string> = {
  admin: "admin",
  arbetsledare: "arbetsledare",
  arbetare: "arbetare",
};

/**
 * "Du agerar som ... i ..." -- shown on every screen, or on none.
 *
 * WHAT IS REAL AND WHAT IS NOT, because the difference matters more than the
 * banner does. THE TENANT IS REAL: enter_tenant() writes a row the database
 * reads, app.current_tenant_id() returns it, and every policy narrows to it --
 * a super admin inside a client tenancy is refused the other tenancies by RLS,
 * not by this component. THE ROLE IS A VIEW PREFERENCE. Nothing in the
 * database demotes a super admin to an arbetare; choosing "arbetare" picks
 * which home screen to draw and nothing else, and that account could still
 * reach an admin route by typing its address. Making the role real means
 * app.current_role() honouring it too, which reaches every is_admin() and
 * is_staff() in the schema -- a change worth making deliberately rather than
 * as part of a banner.
 *
 * It asks the DATABASE whether it is acting rather than trusting what this
 * browser remembers: the answer has to survive a reload, a second tab and a
 * different device, and the client is not the thing that knows.
 *
 * It renders nothing at all when nobody is acting, so it costs every other
 * screen one query and no pixels.
 */
export function AgerarBanner() {
  const { session } = useAuth();
  const router = useRouter();
  const [acting, setActing] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState<ActingRole | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      // Signed out clears it, but from inside the async body like every other
      // write here: a setState called synchronously in an effect cascades a
      // render, and the lint rule that says so is right.
      if (!session) { if (live) setActing(null); return; }

      const { data } = await getSupabase().rpc("acting_tenant");
      if (!live) return;
      const row = Array.isArray(data) ? data[0] : null;
      setActing(row ? { id: row.tenant_id, name: row.tenant_name } : null);
      try {
        const saved = window.sessionStorage.getItem(ACTING_ROLE_KEY);
        setRole(saved === "admin" || saved === "arbetsledare" || saved === "arbetare"
          ? saved : null);
      } catch { setRole(null); }
    })();
    return () => { live = false; };
  }, [session]);

  if (!acting) return null;

  async function leave() {
    setLeaving(true);
    await getSupabase().rpc("exit_tenant");
    try { window.sessionStorage.removeItem(ACTING_ROLE_KEY); } catch { /* private mode */ }
    setActing(null);
    setLeaving(false);
    router.push("/super");
    router.refresh();
  }

  return (
    <div
      data-agerar-banner={acting.name}
      className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-[10px]"
      style={{ background: C.ink, color: C.surface }}
    >
      <span className="min-w-0 text-[14px] font-semibold" style={{ letterSpacing: "-.1px" }}>
        Du agerar som{" "}
        <span className="font-extrabold">{role ? ROLE_WORD[role] : "operatör"}</span>
        {" "}i <span className="font-extrabold">{acting.name}</span>
      </span>
      {/*
        ALWAYS AVAILABLE, never disabled beyond the moment it is working.
        exit_tenant() carries no guard of its own for the same reason: an
        operator who has scoped themselves into somebody else's tenancy needs
        the way out to work even when something else is wrong.
      */}
      <button
        type="button"
        onClick={() => void leave()}
        disabled={leaving}
        className="press-scale shrink-0 rounded-[9px] px-[14px] py-[7px] text-[14px] font-bold transition-transform duration-[110ms] active:scale-[.985]"
        style={{ background: C.surface, color: C.ink }}
      >
        {leaving ? "Lämnar…" : "Lämna"}
      </button>
    </div>
  );
}

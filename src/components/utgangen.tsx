"use client";

import { useEffect, useState } from "react";
import { C, SHADOW } from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { UTGANGEN } from "@/lib/fel";

/**
 * The screen a tenancy meets the morning after its demo runs out.
 *
 * WHY THIS EXISTS AT ALL. The lockout is already complete without it:
 * app.current_tenant_id() returns NULL past the date, in_tenant() coalesces
 * that to false, and all 34 policies close. But closing is all it does -- no
 * error is raised, so nothing reaches fel(), and what the customer actually
 * sees is an app with no projects, no shifts and no reason. That is
 * indistinguishable from the product having broken, and it sends them to
 * support instead of to us.
 *
 * IT ASKS THE DATABASE, not the session or this browser. public.tenant_status()
 * is SECURITY DEFINER for one reason: everything else this account can reach
 * has gone dark, including public.tenant itself, so the only way to learn why
 * is a function that answers from outside the isolation it is reporting on.
 *
 * CHILDREN RENDER WHILE THE ANSWER IS UNKNOWN, deliberately. Gating every page
 * load behind an extra round trip would slow down every tenancy that has not
 * expired -- which is all of them, almost always -- to spare an expired one a
 * moment of empty screen. An expired tenancy's screen is empty anyway; it
 * fills with this a beat later. The cost falls on the case that is already
 * over rather than on the case that is working.
 *
 * AN OPERATOR ACTING INSIDE AN EXPIRED CLIENT IS NOT LOCKED OUT, and gets that
 * for free: tenant_status() reports the caller's OWN tenancy, never the one
 * they entered. The question it answers is "am I shut", and they are not.
 */
export function Utgangen({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [expired, setExpired] = useState<{ name: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!session) { if (live) setExpired(null); return; }

      const { data } = await getSupabase().rpc("tenant_status");
      if (!live) return;
      const row = Array.isArray(data) ? data[0] : null;
      setExpired(row?.expired ? { name: row.name } : null);
    })();
    return () => { live = false; };
  }, [session]);

  if (!expired) return <>{children}</>;

  return (
    <div
      data-utgangen={expired.name}
      className="flex min-h-dvh items-center justify-center px-4 py-10"
      style={{ background: C.ground }}
    >
      <div
        className="w-full max-w-[420px] rounded-[18px] px-6 py-8 text-center"
        style={{ background: C.surface, boxShadow: SHADOW.group }}
      >
        {/*
          The company's own name, because "din provperiod" is worth being sure
          about: an operator who has signed in as themselves and a customer who
          has run out read the same sentence otherwise.
        */}
        <p className="text-[15px] font-semibold" style={{ color: C.text2 }}>
          {expired.name}
        </p>
        <h1
          className="mt-2 text-[22px] font-extrabold leading-[1.25]"
          style={{ color: C.ink, letterSpacing: "-.3px" }}
        >
          Provperioden är slut
        </h1>
        <p className="mt-3 text-[16px] leading-[1.5]" style={{ color: C.text2 }}>
          {UTGANGEN}
        </p>
      </div>
    </div>
  );
}

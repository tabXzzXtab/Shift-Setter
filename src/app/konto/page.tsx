"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { KontoDetalj } from "@/components/konto-detalj";
import { SoftScreen } from "@/components/soft";

/**
 * Konto -- now the same screen as Profil.
 *
 * The two pages asked about one person: this one held the name, the email and
 * the role, /profil held the phone number and the bank account. They are one
 * screen in <KontoDetalj>, and both routes still render it -- they are in
 * menus, in back links, and in whatever anybody has bookmarked.
 *
 * The account being looked at arrives as ?id=. useSearchParams needs a
 * Suspense boundary in a statically exported app -- the query string is not
 * known when the page is prerendered, only when a browser opens it.
 */
function KontoFromUrl() {
  return <KontoDetalj askedId={useSearchParams().get("id")} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Konto" back="/"><span /></SoftScreen>}>
        <KontoFromUrl />
      </Suspense>
    </AuthGate>
  );
}

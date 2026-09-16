"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { KontoDetalj } from "@/components/konto-detalj";
import { SoftScreen } from "@/components/soft";

/**
 * Profil -- now the same screen as Konto. See src/app/konto/page.tsx.
 *
 * Who may read this is still decided in the database and is still narrower
 * than everything else in the app -- self or admin, and deliberately NOT an
 * arbetsledare. A leader is staff for everything to do with shifts and nothing
 * to do with a colleague's bank account. An arbetare who reaches
 * /profil?id=<someone else> loads nothing, because the policy filters the row
 * away rather than this screen declining to draw it.
 */
function ProfilFromUrl() {
  return <KontoDetalj askedId={useSearchParams().get("id")} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Profil" back="/"><span /></SoftScreen>}>
        <ProfilFromUrl />
      </Suspense>
    </AuthGate>
  );
}

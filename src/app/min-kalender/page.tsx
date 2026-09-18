"use client";

import { AuthGate } from "@/components/auth-gate";
import { SoftScreen } from "@/components/soft";
import { Tillganglighet } from "@/components/tillganglighet";

/**
 * Min kalender -- the standalone Arbetsdagar page.
 *
 * The calendar itself moved into <Tillganglighet/> when Mina Pass grew a
 * Tillgänglighet tab; this route stays because the arbetare's landing page
 * still opens it as a grouped row, and one of the two entry points losing the
 * screen would be worse than either of them having it twice. Same component,
 * so the tab and this page cannot disagree about what a painted day means.
 */
export default function Page() {
  return (
    <AuthGate>
      <SoftScreen
        title="Min kalender"
        back="/"
        subtitle="Tryck på en dag, eller dra över flera."
      >
        <Tillganglighet />
      </SoftScreen>
    </AuthGate>
  );
}

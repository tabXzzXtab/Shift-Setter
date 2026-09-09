"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { Card, SoftField, SoftInput, SoftScreen } from "@/components/soft";
import { DagPanel } from "@/components/dag-panel";
import { stockholmToday } from "@/lib/dates";

/**
 * Öppna dag -- everything on one date, on its own page.
 *
 * This is where the shift calendar sends a day: a stripe carries a colour and
 * nothing else, so the answer to "who is working, and on what" has to be a
 * press away. A page rather than a panel underneath the grid, because the
 * answer is long -- every project, every shift, every name on it -- and reading
 * it while the calendar scrolls above is reading it twice.
 *
 * The date picker stays. Arriving without ?datum= it opens on today, which is
 * the day somebody typing the address by hand almost always wants.
 */
function Dag({ asked }: { asked: string | null }) {
  const [date, setDate] = useState(asked ?? stockholmToday());

  return (
    // Back to the calendar when the calendar sent us, and only then. Sending a
    // person who opened this page directly to a screen they never saw is worse
    // than no shortcut at all.
    <SoftScreen title="Öppna dag" back={asked ? "/kalender" : "/"}>
      <div className="px-4 pt-[2px]">
        <Card radius={16} pad="p-[18px]">
          <SoftField label="Datum">
            <SoftInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </SoftField>
        </Card>
      </div>

      <div className="px-4 pt-[22px]">
        <DagPanel date={date} />
      </div>
    </SoftScreen>
  );
}

/**
 * The day arrives as ?datum=. useSearchParams needs a Suspense boundary in a
 * statically exported app -- the query string is not known when the page is
 * prerendered, only when a browser opens it.
 *
 * Shape-checked before it is used. The value reaches a date input and a
 * where-clause, and anything that is not a date belongs in neither.
 */
function DagFromUrl() {
  const asked = useSearchParams().get("datum");
  return <Dag asked={asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Öppna dag" back="/"><span /></SoftScreen>}>
        <DagFromUrl />
      </Suspense>
    </AuthGate>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { Field, Input, Screen } from "@/components/ui";
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
    <Screen title="Öppna dag" back={asked ? "/kalender" : "/"}>
      <Field label="Datum">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <DagPanel date={date} />
    </Screen>
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
      <Suspense fallback={<Screen title="Öppna dag" back="/"><span>Laddar…</span></Screen>}>
        <DagFromUrl />
      </Suspense>
    </AuthGate>
  );
}

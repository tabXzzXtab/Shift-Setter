"use client";

import { useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Field, Input, Screen } from "@/components/ui";
import { DagPanel } from "@/components/dag-panel";
import { stockholmToday } from "@/lib/dates";

/**
 * Öppna dag -- pick a date and see everything on it.
 *
 * The day itself is DagPanel, shared with the shift calendar, so there is one
 * implementation of removing a worker and one of deleting a pass rather than
 * two that can drift apart.
 */
function Dag() {
  const [date, setDate] = useState(stockholmToday());

  return (
    <Screen title="Öppna dag" back="/">
      <Field label="Datum">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <DagPanel date={date} />
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Dag />
    </AuthGate>
  );
}

"use client";

import { useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Notice, Screen } from "@/components/ui";
import { NyArbetareForm } from "@/components/ny-arbetare";

/**
 * Ny arbetare, from the roster. The form itself is shared with Snabb Pass --
 * the same act, so the same copy-then-create sequence.
 */
function NyArbetare() {
  const [done, setDone] = useState<{ name: string; block: string } | null>(null);
  const [key, setKey] = useState(0);

  if (done) {
    return (
      <Screen title="Klar" back="/">
        <Notice kind="ok">{done.name} skapad.</Notice>
        <pre className="mb-6 whitespace-pre-wrap border-2 border-black p-3 text-base">
          {done.block}
        </pre>
        <p className="mb-6 text-base">
          Ge blocket till arbetaren. Det visas inte igen.
        </p>
        <Button onClick={() => { setDone(null); setKey((k) => k + 1); }}>
          Skapa en till
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title="Ny arbetare" back="/">
      <NyArbetareForm
        key={key}
        onCreated={(w, block) => setDone({ name: w.name, block })}
      />
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyArbetare />
    </AuthGate>
  );
}

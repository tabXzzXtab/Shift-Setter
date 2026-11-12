"use client";

import { useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { SoftScreen } from "@/components/soft";
import { NyArbetareBulkForm, InloggningsLista, type CreatedAccount } from "@/components/ny-arbetare-bulk";

function NyArbetareBulk() {
  const [created, setCreated] = useState<CreatedAccount[] | null>(null);
  const [key, setKey] = useState(0);

  if (created) {
    return (
      <SoftScreen title="Inloggningar" back="/installningar">
        <div className="px-4 pt-[14px]">
          <InloggningsLista
            accounts={created}
            onCreateMore={() => { setCreated(null); setKey((k) => k + 1); }}
          />
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen
      title="Skapa konton"
      back="/installningar"
      subtitle="Fyll i namnen och e-posterna — alla skapas på en gång."
    >
      <div className="px-4 pt-[2px]">
        <NyArbetareBulkForm
          key={key}
          onCreated={(accounts) => setCreated(accounts)}
        />
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyArbetareBulk />
    </AuthGate>
  );
}

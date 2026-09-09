"use client";

import { useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { C, Card, PrimaryButton, SoftNotice, SoftScreen } from "@/components/soft";
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
      <SoftScreen title="Klar" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="live">{done.name} skapad.</SoftNotice>
        </div>

        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div
              className="mb-3 text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Inloggning att lämna över
            </div>
            {/* A <pre>, because this is the block that went to the clipboard:
                its line breaks are the format, and a proportional wrap turns a
                password into a guess. */}
            <pre
              className="whitespace-pre-wrap rounded-[10px] p-[14px] text-[15px] font-semibold"
              style={{ background: C.panel2, fontFamily: "inherit" }}
            >
              {done.block}
            </pre>
          </Card>
        </div>

        <p className="px-5 pt-[14px] text-[15px] font-medium" style={{ color: C.text2 }}>
          Ge blocket till arbetaren. Det visas inte igen.
        </p>

        <div className="px-4 pt-[22px]">
          <PrimaryButton onClick={() => { setDone(null); setKey((k) => k + 1); }}>
            Skapa en till
          </PrimaryButton>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Ny arbetare" back="/">
      <div className="px-4 pt-[2px]">
        <NyArbetareForm
          key={key}
          onCreated={(w, block) => setDone({ name: w.name, block })}
        />
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyArbetare />
    </AuthGate>
  );
}

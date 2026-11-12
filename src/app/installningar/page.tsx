"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, ChevronRight, PrimaryButton, SectionLabel, SHADOW, SoftInput,
  SoftNotice, SoftScreen, SoftToast,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { DEFAULT_PRESETS, loadPresets, savePresets, type Presets } from "@/lib/presets";
import { useTourReplay } from "@/components/tour/tour-provider";

/**
 * Inställningar — the company's settings hub.
 *
 * Three sections:
 *   1. Lunch & Rast — configure the three break-duration presets that
 *      appear on shift creation. Stored per bolag (localStorage, tenant-keyed).
 *   2. Företaget — link to the company's document details (address etc.).
 *   3. Guide — replay the first-launch tour.
 *
 * "Alla Konton" moved to /konton; this URL is now the settings hub,
 * matching the Inställningar entry that replaced Guide in every home menu.
 */
function Installningar() {
  const replay = useTourReplay();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [presets, setPresetsState] = useState<Presets>([...DEFAULT_PRESETS]);
  const [inputs, setInputs] = useState<[string, string, string]>(
    DEFAULT_PRESETS.map(String) as [string, string, string],
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await getSupabase().from("tenant").select("id").maybeSingle();
      if (data?.id) {
        setTenantId(data.id);
        const p = loadPresets(data.id);
        setPresetsState(p);
        setInputs(p.map(String) as [string, string, string]);
      }
    })();
  }, []);

  function handleInput(i: 0 | 1 | 2, v: string) {
    setInputs((prev) => {
      const next = [...prev] as [string, string, string];
      next[i] = v;
      return next;
    });
  }

  function handleSave() {
    const parsed = inputs.map((s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 && n <= 240 ? n : NaN;
    });
    if (parsed.some(Number.isNaN)) {
      setError("Ange hela minuter mellan 1 och 240 för varje preset.");
      return;
    }
    setError(null);
    setBusy(true);
    const next = parsed as unknown as Presets;
    if (tenantId) savePresets(tenantId, next);
    setPresetsState(next);
    setBusy(false);
    setSaved("Preseter sparade.");
  }

  return (
    <SoftScreen title="Inställningar" back="/">
      <SoftToast message={saved} onDone={() => setSaved(null)} />

      {/* ---- 1. Lunch & Rast presets ---- */}
      <div className="px-4 pb-[14px] pt-[2px]">
        <SectionLabel>Lunch & Rast</SectionLabel>
        <Card radius={16} pad="p-[18px]">
          <p className="mb-[16px] text-[14px] font-medium" style={{ color: C.text2 }}>
            Tre knappar visas vid passskapande. Tryck en knapp för att dra av den
            break-längden från timfältet. Värdena gäller för hela bolaget.
          </p>

          {error && (
            <div className="mb-[14px]">
              <SoftNotice tone="stop">{error}</SoftNotice>
            </div>
          )}

          <div className="flex flex-col gap-[12px]">
            {(["Preset 1", "Preset 2", "Preset 3"] as const).map((label, i) => (
              <div key={i} className="flex items-center gap-[12px]">
                <span
                  className="w-[64px] shrink-0 text-[14px] font-semibold"
                  style={{ color: C.text2 }}
                >
                  {label}
                </span>
                <div className="flex flex-1 items-center gap-[8px]">
                  <SoftInput
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={240}
                    value={inputs[i as 0 | 1 | 2]}
                    onChange={(e) => handleInput(i as 0 | 1 | 2, e.target.value)}
                    aria-label={`${label} minuter`}
                  />
                  <span className="shrink-0 text-[14px] font-medium" style={{ color: C.text2 }}>
                    min
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-[18px]">
            <PrimaryButton onClick={handleSave} disabled={busy || tenantId === null}>
              {busy ? "Sparar…" : "Spara preseter"}
            </PrimaryButton>
          </div>
        </Card>
      </div>

      {/* ---- 2. Företaget ---- */}
      <div className="px-4 pb-[14px]">
        <SectionLabel>Företaget</SectionLabel>
        <div
          className="overflow-hidden rounded-[14px]"
          style={{ background: C.surface, boxShadow: SHADOW.group }}
        >
          <Link
            href="/foretag"
            className="flex h-[60px] items-center justify-between px-[18px] hover:bg-[#f4f3f0]"
            style={{ color: C.ink }}
          >
            <span className="text-[16px] font-bold" style={{ letterSpacing: "-.2px" }}>
              Företagets uppgifter
            </span>
            <ChevronRight />
          </Link>
          <div className="mx-[18px] h-px" style={{ background: C.hairline }} />
          <Link
            href="/konton"
            className="flex h-[60px] items-center justify-between px-[18px] hover:bg-[#f4f3f0]"
            style={{ color: C.ink }}
          >
            <span className="text-[16px] font-bold" style={{ letterSpacing: "-.2px" }}>
              Alla Konton
            </span>
            <ChevronRight />
          </Link>
        </div>
      </div>

      {/* ---- 3. Guide ---- */}
      {replay && (
        <div className="px-4 pb-[14px]">
          <SectionLabel>Guide</SectionLabel>
          <div
            className="overflow-hidden rounded-[14px]"
            style={{ background: C.surface, boxShadow: SHADOW.group }}
          >
            <button
              type="button"
              onClick={replay}
              className="flex h-[60px] w-full items-center justify-between px-[18px] text-left hover:bg-[#f4f3f0]"
              style={{ color: C.ink }}
            >
              <span className="text-[16px] font-bold" style={{ letterSpacing: "-.2px" }}>
                Starta guiden igen
              </span>
              <ChevronRight />
            </button>
          </div>
        </div>
      )}
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Installningar />
    </AuthGate>
  );
}

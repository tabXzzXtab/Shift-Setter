"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, ChevronRight, PrimaryButton, SecondaryButton, SectionLabel, SHADOW, SoftInput,
  SoftNotice, SoftScreen, SoftToast,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import {
  clearDefaultWorkers, DEFAULT_PRESETS, DEFAULT_WORKER_OPTIONS, loadDefaultWorkers, loadPresets,
  loadWorkerOptions, MAX_WORKERS, saveDefaultWorkers, savePresets, saveWorkerOptions,
  type Presets, type WorkerOptions,
} from "@/lib/presets";
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
  const [, setPresetsState] = useState<Presets>([...DEFAULT_PRESETS]);
  const [inputs, setInputs] = useState<[string, string, string]>(
    DEFAULT_PRESETS.map(String) as [string, string, string],
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Skiftfabrik's starting worker count; null until someone picks one. */
  const [defaultWorkers, setDefaultWorkers] = useState<number | null>(null);
  /** The five counts Skiftfabrik offers: saved, and as being typed. */
  const [workerOptions, setWorkerOptions] = useState<WorkerOptions>([...DEFAULT_WORKER_OPTIONS]);
  const [optionInputs, setOptionInputs] = useState<string[]>(DEFAULT_WORKER_OPTIONS.map(String));
  const [optionError, setOptionError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await getSupabase().from("tenant").select("id").maybeSingle();
      if (data?.id) {
        setTenantId(data.id);
        const p = loadPresets(data.id);
        setPresetsState(p);
        setInputs(p.map(String) as [string, string, string]);
        const o = loadWorkerOptions(data.id);
        setWorkerOptions(o);
        setOptionInputs(o.map(String));
        const d = loadDefaultWorkers(data.id);
        setDefaultWorkers(d !== null && o.includes(d) ? d : null);
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

  function handleSaveOptions() {
    const parsed = optionInputs.map((s) => {
      const n = Number(s.trim());
      return Number.isInteger(n) && n >= 1 && n <= MAX_WORKERS ? n : NaN;
    });
    if (parsed.some(Number.isNaN)) {
      setOptionError(`Ange hela antal mellan 1 och ${MAX_WORKERS} för varje val.`);
      return;
    }
    if (new Set(parsed).size !== parsed.length) {
      setOptionError("Två val har samma antal. Ge varje val ett eget antal.");
      return;
    }
    setOptionError(null);
    const next = [...parsed].sort((a, b) => a - b) as WorkerOptions;
    if (tenantId) {
      saveWorkerOptions(tenantId, next);
      // A default that is no longer one of the options would pre-select a
      // button that does not exist, so it goes with the option it named.
      if (defaultWorkers !== null && !next.includes(defaultWorkers)) {
        clearDefaultWorkers(tenantId);
        setDefaultWorkers(null);
      }
    }
    setWorkerOptions(next);
    setOptionInputs(next.map(String));
    setSaved("Antal sparade.");
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

      {/* ---- Antal arbetare ----
          The five counts are typed and saved like the break presets, with their
          own Spara (white: one filled button per screen, and it is Spara
          preseter's). The default under them is still saved on the tap. */}
      <div className="px-4 pb-[14px]">
        <SectionLabel>Antal arbetare</SectionLabel>
        <Card radius={16} pad="p-[18px]">
          <p className="mb-[16px] text-[14px] font-medium" style={{ color: C.text2 }}>
            Fem knappar visas under &quot;Hur många arbetare?&quot; i Skiftfabriken.
            Värdena gäller för hela bolaget.
          </p>

          {optionError && (
            <div className="mb-[14px]">
              <SoftNotice tone="stop">{optionError}</SoftNotice>
            </div>
          )}

          <div className="flex flex-col gap-[12px]">
            {optionInputs.map((v, i) => (
              <div key={i} className="flex items-center gap-[12px]">
                <span className="w-[64px] shrink-0 text-[14px] font-semibold" style={{ color: C.text2 }}>
                  Val {i + 1}
                </span>
                <div className="flex flex-1 items-center gap-[8px]">
                  <SoftInput
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_WORKERS}
                    value={v}
                    onChange={(e) =>
                      setOptionInputs((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                    }
                    aria-label={`Val ${i + 1} antal arbetare`}
                  />
                  <span className="shrink-0 text-[14px] font-medium" style={{ color: C.text2 }}>
                    st
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-[18px]">
            <SecondaryButton onClick={handleSaveOptions} disabled={tenantId === null}>
              Spara antal
            </SecondaryButton>
          </div>

          <div
            className="mb-[10px] mt-[22px] text-[12px] font-bold uppercase"
            style={{ letterSpacing: ".9px", color: C.text2 }}
          >
            Förvalt i Skiftfabriken
          </div>
          <div className="flex gap-[8px]">
            {workerOptions.map((n) => {
              const active = defaultWorkers === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  disabled={tenantId === null}
                  onClick={() => {
                    if (!tenantId) return;
                    saveDefaultWorkers(tenantId, n);
                    setDefaultWorkers(n);
                    setSaved(`Standard antal arbetare: ${n} st.`);
                  }}
                  className="flex-1 rounded-full py-[10px] text-[15px] font-bold transition-colors disabled:opacity-40"
                  style={{
                    background: active ? C.accent : C.panel2,
                    color: active ? C.onAccent : C.ink,
                    border: `1px solid ${active ? C.accent : C.border}`,
                  }}
                >
                  {n} st
                </button>
              );
            })}
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

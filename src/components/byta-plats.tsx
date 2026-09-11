"use client";

import { useState } from "react";
import { C, ChoiceList, EmptyState, SecondaryButton, SoftDialog, SoftNotice } from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { longDayHeading } from "@/lib/dates";
import { fel } from "@/lib/fel";

export type SwapOptions = {
  tilldelning: string;
  leader_name: string;
  project_name: string;
  work_date: string;
  partners: {
    tilldelning: string;
    worker_id: string;
    name: string;
    project_id: string;
    project_name: string;
    start_time: string;
    end_time: string;
  }[];
};

/** Ask the database who has a day to trade. */
export async function swapPartners(tilldelningId: string) {
  const { data, error } = await getSupabase()
    .rpc("swap_partners", { p_tilldelning: tilldelningId });
  if (error) throw new Error(error.message);
  return data as unknown as SwapOptions;
}

/**
 * Byta Plats Med Arbetsledare -- two leaders trade the same day.
 *
 * NOT Step 5c, and the screen says so. Nobody is being taken off anything:
 * both keep a day, they simply keep each other's. So there is no Ingen
 * Arbetsledare here, nothing recessive, and no warning -- every project
 * involved still has somebody answerable for it when this is done, which is
 * exactly why neither day ends up flagged.
 *
 * Each partner is listed with the hours they are handing over, because that is
 * the part that is easy to get wrong: the envelope belongs to the project and
 * the people on it, so whoever takes this day takes those hours with it.
 */
export function BytaPlats({
  options,
  onDone,
  onClose,
}: {
  options: SwapOptions;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function swap(partner: SwapOptions["partners"][number]) {
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().rpc("swap_leaders", {
      p_a: options.tilldelning,
      p_b: partner.tilldelning,
    });
    setBusy(false);
    if (error) {
      setError(fel(error, "Bytet kunde inte genomföras. Kontakta administratören."));
      return;
    }
    onDone(
      `${options.leader_name} och ${partner.name} har bytt plats. ` +
      `${options.leader_name} tar ${partner.project_name}.`,
    );
  }

  return (
    <SoftDialog label="Byta plats med arbetsledare">
      {error && <div className="pb-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
        Vem ska {options.leader_name} byta plats med?
      </h2>
      <p className="mb-[14px] mt-1 text-[15px] font-medium" style={{ color: C.text2 }}>
        {options.project_name} · {longDayHeading(options.work_date)}
      </p>

      <div className="mb-[14px]">
        {options.partners.length === 0 ? (
          <EmptyState>Ingen annan arbetsledare har ett pass att byta den dagen.</EmptyState>
        ) : (
          <ChoiceList
            disabled={busy}
            choices={options.partners.map((p) => ({
              key: p.tilldelning,
              label: p.name,
              sub: `${p.project_name} · ${p.start_time}–${p.end_time}`,
              onClick: () => swap(p),
            }))}
          />
        )}
      </div>

      <SecondaryButton onClick={onClose} disabled={busy}>
        Avbryt
      </SecondaryButton>
    </SoftDialog>
  );
}

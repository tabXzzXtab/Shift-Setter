"use client";

import { useState } from "react";
import { Button, Notice } from "./ui";
import { getSupabase } from "@/lib/supabase/client";
import { longDayHeading } from "@/lib/dates";

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
    if (error) { setError(error.message); return; }
    onDone(
      `${options.leader_name} och ${partner.name} har bytt plats. ` +
      `${options.leader_name} tar ${partner.project_name}.`,
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Byta plats med arbetsledare"
    >
      <div className="mx-auto w-full max-w-md border-2 border-black bg-white p-4">
        {error && <Notice kind="error">{error}</Notice>}

        <h2 className="mb-1 text-xl font-bold">
          Vem ska {options.leader_name} byta plats med?
        </h2>
        <p className="mb-4 text-base">
          {options.project_name} · {longDayHeading(options.work_date)}
        </p>

        {options.partners.length === 0 ? (
          <p className="mb-4 border-2 border-dashed border-black p-4 text-center text-base">
            Ingen annan arbetsledare har ett pass att byta den dagen.
          </p>
        ) : (
          <div className="mb-4 flex flex-col gap-2">
            {options.partners.map((p) => (
              <button
                key={p.tilldelning}
                type="button"
                onClick={() => swap(p)}
                disabled={busy}
                className="flex min-h-[64px] w-full items-center justify-between gap-3 border-2 border-black px-4 text-left disabled:opacity-30"
              >
                <span>
                  <span className="block text-lg font-bold">{p.name}</span>
                  <span className="block text-base">
                    {p.project_name} · {p.start_time}–{p.end_time}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-2xl">⇄</span>
              </button>
            ))}
          </div>
        )}

        <Button variant="outline" onClick={onClose} disabled={busy}>
          Avbryt
        </Button>
      </div>
    </div>
  );
}

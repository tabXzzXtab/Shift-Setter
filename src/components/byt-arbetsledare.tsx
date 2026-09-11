"use client";

import { useState } from "react";
import {
  C, ChoiceList, EmptyState, SecondaryButton, SoftDialog, SoftNotice,
} from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";
import { longDayHeading } from "@/lib/dates";
import { fel } from "@/lib/fel";

export type Options = {
  tilldelning: string;
  leader_name: string;
  project_id: string;
  project_name: string;
  work_date: string;
  leaders: { worker_id: string; name: string }[];
  roster: { worker_id: string; name: string }[];
};

/** Ask the database who could take the day. */
export async function replacementOptions(tilldelningId: string) {
  const { data, error } = await getSupabase()
    .rpc("leader_replacement_options", { p_tilldelning: tilldelningId });
  if (error) throw new Error(error.message);
  return data as unknown as Options;
}

/**
 * Step 5c -- Avboka Pass on an arbetsledare.
 *
 * A leader is never simply removed. Somebody has to be answerable for the day,
 * so taking one off forces the question of who takes their place, and the
 * popup is that question with its three answers.
 *
 * ROUTES 2 AND 3 ARE THE ADMIN'S. Swapping one arbetsledare for another is a
 * like-for-like change anyone who can take a leader off may make. Deciding
 * that a day will run with a worker covering, or with nobody at all, decides
 * that only the owner may ever close it -- an admission about the company, and
 * the spec puts it in his hands. A leader who needs it and has nobody free is
 * told to ask, rather than shown two buttons the database will refuse.
 *
 * THE ORDER ON SCREEN IS THE ORDER OF PREFERENCE, and the weight matches.
 * Another arbetsledare is a list of ordinary buttons, because that is the
 * outcome that changes nothing else. Gör Arbetare Ansvarig is offered only
 * once there is no leader to offer -- a list of nobody asks a question with no
 * answers in it. And Ingen Arbetsledare is a small underlined line at the
 * bottom: it is the worst of the three, it is the only one that leaves a day
 * with nobody answerable for it, and it must never be the easy press.
 */
export function BytArbetsledare({
  options,
  onDone,
  onClose,
}: {
  options: Options;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const { account } = useAccount();
  const isAdmin = account?.role === "admin";
  const [roster, setRoster] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, said: string) {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setError(fel(error, "Arbetsledaren kunde inte bytas. Kontakta administratören."));
      return;
    }
    onDone(said);
  }

  const swap = (workerId: string, name: string) =>
    run(
      () => getSupabase().rpc("replace_leader", {
        p_tilldelning: options.tilldelning, p_worker: workerId,
      }),
      `${name} tog över dagen från ${options.leader_name}.`,
    );

  const ansvarig = (workerId: string, name: string) =>
    run(
      () => getSupabase().rpc("make_worker_ansvarig", {
        p_tilldelning: options.tilldelning, p_worker: workerId,
      }),
      `${name} är ansvarig för dagen. Bara administratören kan bekräfta den.`,
    );

  const unsupervised = () =>
    run(
      () => getSupabase().rpc("leave_day_unsupervised", {
        p_tilldelning: options.tilldelning,
      }),
      "Dagen körs utan arbetsledare. Bara administratören kan bekräfta den.",
    );

  return (
    <SoftDialog label="Byt arbetsledare">
      {error && <div className="pb-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
        Vem ska byta ut {options.leader_name}?
      </h2>
      <p className="mb-[14px] mt-1 text-[15px] font-medium" style={{ color: C.text2 }}>
        {options.project_name} · {longDayHeading(options.work_date)}
      </p>

      {options.leaders.length > 0 ? (
        <div className="mb-[14px]">
          <ChoiceList
            disabled={busy}
            choices={options.leaders.map((l) => ({
              key: l.worker_id,
              label: l.name,
              onClick: () => swap(l.worker_id, l.name),
            }))}
          />
        </div>
      ) : (
        <>
          <p className="mb-[14px] text-[15px] font-medium" style={{ color: C.text2 }}>
            Ingen annan arbetsledare är ledig den dagen.
          </p>

          {!isAdmin && (
            <div className="mb-[14px]">
              <SoftNotice tone="quiet">
                Kontakta administratören. Bara han kan låta dagen köras utan
                arbetsledare.
              </SoftNotice>
            </div>
          )}

          {/* Offered only when there is no leader to offer, and only to the
              person who may make that call. */}
          {isAdmin && !roster ? (
            <div className="mb-[14px]">
              <SecondaryButton onClick={() => setRoster(true)} disabled={busy}>
                Gör Arbetare Ansvarig
              </SecondaryButton>
            </div>
          ) : isAdmin ? (
            <div className="mb-[14px]">
              <p className="mb-[10px] text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
                Vem på passet höll ihop dagen? Dagen går då direkt till
                administratören.
              </p>
              {options.roster.length > 0 ? (
                <ChoiceList
                  disabled={busy}
                  choices={options.roster.map((r) => ({
                    key: r.worker_id,
                    label: r.name,
                    onClick: () => ansvarig(r.worker_id, r.name),
                  }))}
                />
              ) : (
                <EmptyState>Ingen är tilldelad passet.</EmptyState>
              )}
            </div>
          ) : null}
        </>
      )}

      <SecondaryButton onClick={onClose} disabled={busy}>
        Avbryt
      </SecondaryButton>

      {/* The least prominent control on the popup, deliberately. It is the
          worst of the three outcomes and must never be the easy press. */}
      {isAdmin && (
        <div className="pt-[18px] text-center">
          <button
            type="button"
            onClick={unsupervised}
            disabled={busy}
            className="text-[14px] font-medium underline underline-offset-2 disabled:opacity-40"
            style={{ color: C.text2 }}
          >
            Ingen Arbetsledare
          </button>
        </div>
      )}
    </SoftDialog>
  );
}

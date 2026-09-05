"use client";

import { useState } from "react";
import { Button, Notice } from "./ui";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";
import { longDayHeading } from "@/lib/dates";

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
    if (error) { setError(error.message); return; }
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
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Byt arbetsledare"
    >
      <div className="mx-auto w-full max-w-md border-2 border-black bg-white p-4">
        {error && <Notice kind="error">{error}</Notice>}

        <h2 className="mb-1 text-xl font-bold">
          Vem ska byta ut {options.leader_name}?
        </h2>
        <p className="mb-4 text-base">
          {options.project_name} · {longDayHeading(options.work_date)}
        </p>

        {options.leaders.length > 0 ? (
          <div className="mb-4 flex flex-col gap-2">
            {options.leaders.map((l) => (
              <button
                key={l.worker_id}
                type="button"
                onClick={() => swap(l.worker_id, l.name)}
                disabled={busy}
                className="flex min-h-[56px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold disabled:opacity-30"
              >
                <span>{l.name}</span>
                <span aria-hidden className="text-2xl">→</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="mb-4 text-base">
              Ingen annan arbetsledare är ledig den dagen.
            </p>

            {!isAdmin && (
              <p className="mb-4 border-2 border-black p-3 text-base">
                Kontakta administratören. Bara han kan låta dagen köras utan
                arbetsledare.
              </p>
            )}

            {/* Offered only when there is no leader to offer, and only to the
                person who may make that call. */}
            {isAdmin && !roster ? (
              <div className="mb-4">
                <Button variant="outline" onClick={() => setRoster(true)} disabled={busy}>
                  Gör Arbetare Ansvarig
                </Button>
              </div>
            ) : isAdmin ? (
              <div className="mb-4 flex flex-col gap-2">
                <p className="text-base">
                  Vem på passet höll ihop dagen? Dagen går då direkt till
                  administratören.
                </p>
                {options.roster.map((r) => (
                  <button
                    key={r.worker_id}
                    type="button"
                    onClick={() => ansvarig(r.worker_id, r.name)}
                    disabled={busy}
                    className="flex min-h-[56px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold disabled:opacity-30"
                  >
                    <span>{r.name}</span>
                    <span aria-hidden className="text-2xl">→</span>
                  </button>
                ))}
                {options.roster.length === 0 && (
                  <p className="border-2 border-dashed border-black p-4 text-center text-base">
                    Ingen är tilldelad passet.
                  </p>
                )}
              </div>
            ) : null}
          </>
        )}

        <Button variant="outline" onClick={onClose} disabled={busy}>
          Avbryt
        </Button>

        {/* The least prominent control on the popup, deliberately. It is the
            worst of the three outcomes and must never be the easy press. */}
        {isAdmin && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={unsupervised}
              disabled={busy}
              className="text-sm underline underline-offset-2 disabled:opacity-30"
            >
              Ingen Arbetsledare
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

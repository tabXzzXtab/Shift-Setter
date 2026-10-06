"use client";

import { C, DangerButton, SecondaryButton, SoftDialog } from "@/components/soft";

/**
 * "This person did not stamp" and "this person did not come" are one control.
 *
 * What is left is a line and a question. The line says the row is unaccounted
 * for; pressing it asks the only question an unaccounted row raises, and the
 * answer writes the figure that says so.
 */

/**
 * A worker's stamps, as ONE LINE under their name (owner, 2026-10-06).
 *
 * It used to be two things saying one fact: a grey "Ej stämplad" pill beside
 * the name -- a tinted chip, the pattern the Komponentspråk removed everywhere
 * else -- and "Stämplade — till —" under it, a reading made of dashes. Now the
 * line IS the status, in the app's status language: ink and a dot, no box.
 *
 *   both ends   "Stämplade 07:02–16:01" in the secondary ink. The ordinary
 *               case, so it is quiet.
 *   in only     amber dot, "Instämplad 07:02 · ej utstämplad". Somebody worked
 *               and forgot the other end.
 *   neither     amber dot, "Ej stämplad" and a chevron: the one row this screen
 *               exists to ask about, and the press that asks it. The 44px
 *               target is the whole line, and the person's name is the
 *               button's name -- "Jobbade Anna Karlsson inte idag?" is where
 *               the press leads.
 */
export function StampLine({
  name, clockIn, clockOut, onAsk, disabled,
}: {
  name: string;
  /** "07:02", or "" when there is no stamp at that end. */
  clockIn: string;
  clockOut: string;
  onAsk: () => void;
  disabled?: boolean;
}) {
  const dot = <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: C.warnMark }} />;
  if (clockIn && clockOut) {
    return (
      <div data-stamp="done" className="mb-[12px] mt-[2px] text-[14px] font-medium" style={{ color: C.text2 }}>
        Stämplade {clockIn}–{clockOut}
      </div>
    );
  }
  if (clockIn) {
    return (
      <div data-stamp="in" className="mb-[12px] mt-[2px] flex items-center gap-[7px] text-[14px] font-semibold" style={{ color: C.warnInk }}>
        {dot}Instämplad {clockIn} · ej utstämplad
      </div>
    );
  }
  return (
    <button
      type="button"
      data-stamp="none"
      aria-label={`Jobbade ${name} inte idag?`}
      onClick={onAsk}
      disabled={disabled}
      className="-mt-[8px] mb-[2px] flex h-11 items-center gap-[7px] text-[14px] font-semibold transition-opacity active:opacity-60 disabled:opacity-40"
      style={{ color: C.warnInk }}
    >
      {dot}
      Ej stämplad
      <svg width="7" height="12" viewBox="0 0 7 12" aria-hidden className="ml-[2px]">
        <path d="M1 1l5 5-5 5" fill="none" stroke={C.chevron} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * The question, asked before the figure is written.
 *
 * ZERO HOURS IS A CLAIM ABOUT A HUMAN BEING, not a blank. It is the one value
 * on these screens that says "this person was not here", and it prints in the
 * Arbetsdagbok as such. Typing it and being asked about it are different acts,
 * and the confirmation is why the mark can be a single press.
 *
 * Escape closes it and the scrim does not, which is SoftDialog's rule for
 * every dialog that sits in front of a decision.
 */
export function JobbadeInteDialog({
  name, onConfirm, onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <SoftDialog label={`Jobbade ${name} inte idag?`} onDismiss={onCancel}>
      <div className="mb-[6px] text-[20px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
        Jobbade {name} inte idag?
      </div>
      <p
        className="mb-[18px] text-[15px] font-medium"
        style={{ color: C.text2, textWrap: "pretty" }}
      >
        Fortsätter du loggas inga timmar för personen på den här dagen.
      </p>
      <div className="flex flex-col gap-[10px]">
        <DangerButton solid onClick={onConfirm}>Ja, inga timmar</DangerButton>
        <SecondaryButton onClick={onCancel}>Avbryt</SecondaryButton>
      </div>
    </SoftDialog>
  );
}

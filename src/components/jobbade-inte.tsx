"use client";

import { C, DangerButton, SecondaryButton, SoftDialog } from "@/components/soft";

/**
 * "This person did not stamp" and "this person did not come" are one control.
 *
 * The screens used to say both in words -- a grey "Ej stämplad" chip on the
 * row, and a line under the hours reading "0 timmar och 00 minuter om personen
 * inte kom". Two sentences to carry one question, on a screen whose whole job
 * is asking it, and neither of them was a thing you could press.
 *
 * What is left is a mark and a question. The mark says the row is unaccounted
 * for; pressing it asks the only question an unaccounted row raises, and the
 * answer writes the figure that says so.
 */

/**
 * The mark: a red square, drawn and nothing else.
 *
 * NO TILE BEHIND IT. Every other icon control in the app sits on a fill --
 * the Konton trash on #fbe9ec, the Dag-panel remove on the same -- because
 * those are buttons among other buttons and need an edge. This one sits at the
 * end of a name on a card that has no other controls in that line, and a
 * second rounded rectangle inside a card made of rounded rectangles reads as a
 * badge rather than as something to press. The square IS the affordance.
 *
 * The tap target is still 28px around a 14px glyph, and the negative margin
 * keeps that from pushing the name's line taller than it was.
 */
export function EjStampladMark({
  name, onClick, disabled,
}: {
  /** The person the question will be about. Their name IS the button's name:
   *  "Jobbade Anna Karlsson inte idag?" is what the press leads to, and a
   *  screen reader saying "knapp" would be saying nothing. */
  name: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Jobbade ${name} inte idag?`}
      onClick={onClick}
      disabled={disabled}
      className="press-scale -my-[7px] flex h-[28px] w-[28px] shrink-0 items-center justify-center transition-transform duration-[110ms] active:scale-[.92] disabled:opacity-40"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <rect width="14" height="14" rx="3" fill={C.stopInk} />
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

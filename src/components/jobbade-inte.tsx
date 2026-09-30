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
 * The mark: the handoff's status tag -- "Ej stämplad" in the warn pair.
 *
 * A WORD, NOT A SQUARE. It used to be a 14px red square in a 28px target: a
 * signal in colour alone, under the 44px minimum, and not recognisable as the
 * thing to press (UI audit, Granska). The handoff draws the unstamped state as
 * a tag ("Ej utstämplad", amber) and says colour is never the only carrier, so
 * this is that tag, pressable.
 *
 * The tap target is the full 44px; the pill inside it is the tag's own size,
 * and the negative margin keeps the target from pushing the name's line
 * taller than it was.
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
      className="press-scale -my-[9px] flex h-11 shrink-0 items-center transition-transform duration-[110ms] active:scale-[.97] disabled:opacity-40"
    >
      <span
        className="inline-flex items-center whitespace-nowrap rounded-full px-[10px] py-[5px] text-[12px] font-bold"
        style={{ letterSpacing: ".4px", color: C.tagWarnInk, background: C.warnBg }}
      >
        Ej stämplad
      </span>
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

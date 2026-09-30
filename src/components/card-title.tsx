import type { ReactNode } from "react";
import { C } from "./soft";

/**
 * A titled card's title: the handoff's Title M -- 18/700, -0.4px, ink, sentence
 * case -- INSIDE the card, above its fields.
 *
 * Not the kicker. A card title set as 12/700 uppercase sat directly on a field
 * label set exactly the same way ("PROJEKTET" over "PROJEKTNAMN"), so the two
 * read as one label and the card had no visible title (UI audit). Field labels
 * stay kickers; the title is a size and a case above them.
 *
 * `mb={4}` where a help line follows the title rather than a field.
 */
export function CardTitle({ children, mb = 14 }: { children: ReactNode; mb?: 4 | 14 }) {
  return (
    <div
      className={`${mb === 4 ? "mb-1" : "mb-[14px]"} text-[18px] font-bold`}
      style={{ letterSpacing: "-.4px", color: C.ink }}
    >
      {children}
    </div>
  );
}

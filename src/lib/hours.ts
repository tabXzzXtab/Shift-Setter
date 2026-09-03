/**
 * The hours a shift is created with, by default.
 *
 *   (end - start) - 30 minutes
 *
 * This is a PREFILL, not a derivation. Invariant 1 says nothing derives hours
 * from the span, and that still holds: this number is put in front of a human
 * who must accept or correct it, it stops following the span the moment they
 * type their own figure, and nothing ever recomputes it afterwards. The spec
 * already draws that line for an auto-assigned leader's prefilled hours; this
 * is the same line at creation.
 *
 * Thirty minutes because that is the ordinary unpaid break. Where the real
 * break is longer -- and it often is -- the leader types the real number, which
 * is exactly why the field stays editable and independent of the two times.
 */
export function defaultHours(start: string, end: string): string {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  const s = toMinutes(start);
  const e = toMinutes(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "";

  // An end at or before the start crosses midnight -- night shifts are real
  // here, and 22:00-06:00 is eight hours, not minus sixteen.
  const span = (e <= s ? e + 24 * 60 : e) - s;

  const worked = Math.max(0, span - 30);
  const hours = Math.round((worked / 60) * 100) / 100;

  // Swedish decimal comma, and no trailing ",0" on a whole number.
  return Number.isInteger(hours) ? String(hours) : String(hours).replace(".", ",");
}

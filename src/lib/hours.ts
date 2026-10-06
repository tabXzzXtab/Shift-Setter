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
 * AN AUTO-ASSIGNED ARBETSLEDARE GETS THE SAME (owner, 2026-10-06). Their
 * prefill on Bekräfta is the workers' envelope minus the same half hour --
 * "lunch comes off the envelope like anyone else's". It used to be the whole
 * envelope, on the reading that the break was theirs to subtract; in testing
 * that gave Lars 0,75 h for a 45-minute envelope where 0,25 was right.
 *
 * Thirty minutes because that is the ordinary unpaid break. Where the real
 * break is longer -- and it often is -- the leader types the real number, which
 * is exactly why the field stays editable and independent of the two times.
 */
export function defaultHours(start: string, end: string): string {
  return format(minutesBetween(start, end) - 30);
}

function minutesBetween(start: string, end: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  const s = toMinutes(start);
  const e = toMinutes(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return NaN;

  // An end at or before the start crosses midnight -- night shifts are real
  // here, and 22:00-06:00 is eight hours, not minus sixteen.
  return (e <= s ? e + 24 * 60 : e) - s;
}

function format(minutes: number): string {
  if (!Number.isFinite(minutes)) return "";
  const hours = Math.round((Math.max(0, minutes) / 60) * 100) / 100;

  // Swedish decimal comma, and no trailing ",0" on a whole number.
  return Number.isInteger(hours) ? String(hours) : String(hours).replace(".", ",");
}

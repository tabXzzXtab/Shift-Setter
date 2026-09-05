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
  return format(minutesBetween(start, end) - 30);
}

/**
 * The whole span, with no break taken off -- an auto-assigned arbetsledare's
 * prefill (Step 4b).
 *
 * Deliberately different from defaultHours. The spec says a leader's hours are
 * "prefilled from that span" and that "the prefilled number is a starting point
 * the leader overwrites before confirming -- lunch comes off it like anyone
 * else's". So the break is theirs to subtract, not ours to assume: their day is
 * the workers' envelope, and a leader who was on site from the first arrival to
 * the last departure did not necessarily take the same half hour anyone else
 * did.
 *
 * Still a prefill, not a derivation. Invariant 1 holds for the same reason it
 * holds above: a human accepts or corrects this figure before it is stored.
 */
export function spanHours(start: string, end: string): string {
  return format(minutesBetween(start, end));
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

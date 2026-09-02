/**
 * Invariant 9: dates are Stockholm-anchored.
 *
 * The database stores work_date as a plain `date` and every server-side
 * comparison goes through app.stockholm_today(). The browser must agree, or a
 * shift files under the wrong day for anyone whose machine is set to another
 * zone -- and at 01:00 Stockholm in summer, UTC is still yesterday.
 *
 * sv-SE formatting already produces YYYY-MM-DD, which is also what Postgres
 * wants, so no reformatting step can get between the two.
 */
const YMD = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WEEKDAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  weekday: "long",
});

/** Today in Stockholm, as YYYY-MM-DD. */
export function stockholmToday(): string {
  return YMD.format(new Date());
}

/** A YYYY-MM-DD offset by whole days, without leaving the date domain. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  // Noon UTC: far enough from either midnight that no DST shift can move the day.
  const t = new Date(Date.UTC(y!, m! - 1, d!, 12));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** "MÅNDAG 16 AUG" -- the confirmation list's day heading. */
export function longDayHeading(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const weekday = WEEKDAY.format(t).toUpperCase();
  const month = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    month: "short",
  }).format(t).replace(".", "").toUpperCase();
  return `${weekday} ${d} ${month}`;
}

/** HH:MM from a stored time value, which Postgres returns as HH:MM:SS. */
export function hhmm(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "";
}

/** A clock stamp shown to a human, in Stockholm. */
export function stampToTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Minutes that Stockholm is ahead of UTC at a given instant (60 or 120). */
function stockholmOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});

  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return (asUtc - at.getTime()) / 60000;
}

/**
 * A Stockholm wall-clock time as a real instant.
 *
 * The offset depends on the instant, and the instant depends on the offset, so
 * this guesses once and corrects. The correction is what makes the last Sunday
 * in March and October come out right instead of an hour wrong twice a year.
 */
export function stockholmWallClock(ymd: string, time: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y!, m! - 1, d!, hh!, mi!);

  const first = new Date(naive - stockholmOffsetMinutes(new Date(naive)) * 60000);
  const settled = stockholmOffsetMinutes(first);
  return new Date(naive - settled * 60000);
}

/**
 * When a shift actually ends. An end at or before its start crosses midnight --
 * night shifts are real here, so 22:00-06:00 ends the next morning.
 * Mirrors app.pass_end_at() exactly; if one changes, so must the other.
 */
export function passEndAt(ymd: string, start: string, end: string): Date {
  const s = hhmm(start);
  const e = hhmm(end);
  return stockholmWallClock(e <= s ? addDays(ymd, 1) : ymd, e);
}

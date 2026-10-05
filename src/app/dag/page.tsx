"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { C, IconButton, SoftScreen } from "@/components/soft";
import { DayTimeline } from "@/components/day-timeline";
import { addDays, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";

/**
 * A day, top to bottom -- where every calendar sends a tapped day.
 *
 * THE WHOLE DAY ON ONE SCREEN, AS A TIMELINE. The date is the title, a week
 * strip moves between days, and the timeline (DayTimeline) lays out every pass
 * and every ärende by its times. Nothing hides below a fold and nothing is a
 * card inside a card. What acts on a pass lives one tap further in, on the
 * project's day (/dag/projekt); what creates something lives behind the + on
 * its own full screen.
 *
 * THE + BY ROLE. The admin gets a choice, Pass or Ärende (/dag/ny). An
 * arbetsledare creates passes only: on a day still ahead the + goes straight
 * to the pass form with the day set; on a day already gone it opens the same
 * choice screen, where Pass is shown disabled with the reason. An arbetare
 * reads the day and gets no +. None of this is a boundary -- the database
 * refuses a pass or an ärende from anyone it should -- it is not offering
 * what cannot be done.
 *
 * Arriving without ?datum= it opens on today. ?fran= is where the back button
 * goes: the calendar that sent us, or Mina pass.
 */
function dayTitle(ymd: string): string {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(`${ymd}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Monday of the week that holds `ymd`. */
function mondayOf(ymd: string): string {
  const dow = (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
}

function Dag({ date, from }: { date: string; from: string }) {
  const { account } = useAccount();
  const role = account?.role;
  const today = stockholmToday();
  const past = date < today;
  const encoded = encodeURIComponent(from);
  /** This day, as the place the screens it opens come back to. */
  const here = `/dag?datum=${date}&fran=${encoded}`;

  const plus =
    role === "admin" || (role === "arbetsledare" && past)
      ? `/dag/ny?datum=${date}&fran=${encodeURIComponent(here)}`
      : role === "arbetsledare"
        ? `/pass/ny?datum=${date}&fran=dag`
        : null;

  const monday = mondayOf(date);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <SoftScreen
      title={dayTitle(date)}
      back={from}
      action={plus ? (
        <IconButton label="Lägg till" href={plus}>
          <svg width="16" height="16" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M7.5 1v13M1 7.5h13" stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </IconButton>
      ) : undefined}
    >
      {/* THE WEEK, to move a day at a time without going back to the month. */}
      <nav aria-label="Veckan" className="grid grid-cols-7 gap-[2px] px-4 pb-[18px] pt-[2px]">
        {week.map((d) => {
          const on = d === date;
          const isToday = d === today;
          const letter = ["M", "T", "O", "T", "F", "L", "S"][(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7];
          return (
            <Link
              key={d}
              href={`/dag?datum=${d}&fran=${encoded}`}
              replace
              aria-current={on ? "date" : undefined}
              aria-label={dayTitle(d)}
              className="flex h-[56px] flex-col items-center justify-center gap-[2px] rounded-[12px]"
              style={{
                background: on ? C.accent : "transparent",
                color: on ? C.onAccent : C.ink,
                boxShadow: isToday && !on ? `inset 0 0 0 2px ${C.ink}` : undefined,
              }}
            >
              <span className="text-[11px] font-bold" style={{ color: on ? C.onAccent : C.text2 }}>{letter}</span>
              <span className="text-[17px] font-extrabold tabular-nums">{Number(d.slice(8))}</span>
            </Link>
          );
        })}
      </nav>

      <DayTimeline key={date} date={date} from={here} readOnly={role === "arbetare"} />
    </SoftScreen>
  );
}

/**
 * The day arrives as ?datum=, and where to go back to as ?fran=. useSearchParams
 * needs a Suspense boundary in a statically exported app. Both are
 * shape-checked: a date or today, and an in-app path or the role's calendar.
 */
function DagFromUrl() {
  const params = useSearchParams();
  const { account } = useAccount();
  const asked = params.get("datum");
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : stockholmToday();
  const fran = params.get("fran");
  const from = fran && fran.startsWith("/") && !fran.startsWith("//")
    ? fran
    : account?.role === "admin" ? "/kalender" : "/mina-pass";
  return <Dag date={date} from={from} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Dagen" back="/"><span /></SoftScreen>}>
        <DagFromUrl />
      </Suspense>
    </AuthGate>
  );
}

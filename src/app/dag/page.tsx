"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, SHADOW, SoftField, SoftInput, SoftNotice, SoftScreen,
} from "@/components/soft";
import { DagPanel } from "@/components/dag-panel";
import {
  EventCard, HANDELSE_COLUMNS, NyHandelse, pickableFrom, useKonton, type Handelse,
} from "@/components/handelse";
import { getSupabase } from "@/lib/supabase/client";
import { longDayHeading, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { fel } from "@/lib/fel";

/**
 * Öppna dag -- everything on one date, on its own page.
 *
 * This is where the shift calendar sends a day: a stripe carries a colour and
 * nothing else, so the answer to "who is working, and on what" has to be a
 * press away. A page rather than a panel underneath the grid, because the
 * answer is long -- every project, every shift, every name on it -- and reading
 * it while the calendar scrolls above is reading it twice.
 *
 * The date picker stays. Arriving without ?datum= it opens on today, which is
 * the day somebody typing the address by hand almost always wants.
 *
 * THE ADMIN GETS THREE ACTIONS ABOVE THE DAY, and only the admin. Two of them
 * carry the date into screens that would otherwise open on today -- pressing
 * the 3rd and then typing "3rd" again is the sort of step that gets skipped
 * once and puts a shift on the wrong day. The third writes an ärende, which is
 * the one thing on this page that is NOT shift data: it makes nobody
 * unavailable, it reaches no queue, and it prints in no Arbetsdagbok.
 *
 * Admin-gated because two of the three are: the database refuses a Snabb Pass
 * from anybody else, and an arbetsledare reading this page is reading somebody
 * else's day as often as their own. An ärende they were NAMED on still shows
 * here -- being told about a day is not the same as arranging one.
 */
function Dag({ asked }: { asked: string | null }) {
  const { account } = useAccount();
  const [date, setDate] = useState(asked ?? stockholmToday());
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Bumped on every write, so the day's ärenden re-read. */
  const [tick, setTick] = useState(0);

  const konton = useKonton();
  const me = account?.id ?? null;
  const isAdmin = account?.role === "admin";

  /** Moving the date is moving day: a half-typed ärende for the 3rd must not
   *  be sitting there when the picker says the 4th. */
  function moveTo(next: string) {
    setDate(next);
    setComposing(false);
    setNote(null);
  }

  return (
    // Back to the calendar when the calendar sent us, and only then. Sending a
    // person who opened this page directly to a screen they never saw is worse
    // than no shortcut at all.
    <SoftScreen title="Öppna dag" back={asked ? "/kalender" : "/"}>
      <div className="px-4 pt-[2px]">
        <Card radius={16} pad="p-[18px]">
          <SoftField label="Datum">
            <SoftInput type="date" value={date} onChange={(e) => moveTo(e.target.value)} />
          </SoftField>
        </Card>
      </div>

      {/* The day as a kicker, not a headline: longDayHeading returns caps
          because every other screen sets it at 12/700, and the same string at
          22/800 shouts. The picker directly above already says which day this
          is in full. */}
      <p
        className="px-[20px] pt-[22px] text-[12px] font-bold uppercase"
        style={{ letterSpacing: "1px", color: C.text2 }}
      >
        {longDayHeading(date)}
      </p>

      {isAdmin && (
        <div className="px-4 pt-[10px]">
          {composing ? (
            <NyHandelse
              date={date}
              ownerId={me}
              pickable={pickableFrom(konton, me)}
              onCancel={() => setComposing(false)}
              onSaved={() => {
                setComposing(false);
                setNote("Ärendet är sparat.");
                setTick((t) => t + 1);
              }}
            />
          ) : (
            <Atgarder date={date} onArende={() => { setComposing(true); setNote(null); }} />
          )}
        </div>
      )}

      {note && (
        <div className="px-4 pt-[14px]"><SoftNotice tone="quiet">{note}</SoftNotice></div>
      )}

      <div className="px-4 pt-[22px]">
        <DagPanel date={date} heading={false} />
      </div>

      <DagArenden date={date} tick={tick} me={me} konton={konton} onChanged={() => setTick((t) => t + 1)} />
    </SoftScreen>
  );
}

/**
 * The three things an admin does to a day, in the handoff's Skapa card.
 *
 * The same object the admin's landing page uses: one accent 60px action over a
 * pair of 56px secondaries. Tilldela Ärende is the accent because it is the
 * only one that happens HERE -- the other two are doors, and a door drawn as
 * loudly as the thing that acts on this screen would make the page read as a
 * menu rather than as a day.
 */
function Atgarder({ date, onArende }: { date: string; onArende: () => void }) {
  return (
    <Card radius={16} shadow={SHADOW.hero} pad="px-[18px] pb-5 pt-[18px]">
      <div
        className="mb-3 text-[12px] font-bold uppercase"
        style={{ letterSpacing: "1px", color: C.text2 }}
      >
        Lägg till
      </div>

      <button
        type="button"
        onClick={onArende}
        className="press-scale mb-[10px] flex h-[60px] w-full items-center justify-center gap-[10px] rounded-[12px] text-[18px] font-extrabold transition-[transform,background] duration-150 hover:bg-[#12206b] active:scale-[.985]"
        style={{
          letterSpacing: "-.4px",
          background: C.accent,
          color: C.surface,
          boxShadow: "0 6px 18px rgba(27,44,193,.26)",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <path d="M7.5 1v13M1 7.5h13" stroke={C.surface} strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        Tilldela Ärende
      </button>

      {/* The date travels in the query string, and both destinations shape-check
          it before it reaches a date input or a where-clause. */}
      <div className="flex gap-[10px]">
        {[
          { href: `/snabb?datum=${date}`, label: "Snabb Pass" },
          { href: `/pass/ny?datum=${date}`, label: "Skapa Pass" },
        ].map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="press-scale flex h-14 flex-1 items-center justify-center rounded-[12px] text-[16px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
            style={{ letterSpacing: "-.2px", background: C.panel2, color: C.inkHover }}
          >
            {a.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

/**
 * The ärenden on this date -- the owner's own, and the ones they were named on.
 *
 * BELOW THE SHIFTS AND IN THEIR OWN SECTION, because they are a different kind
 * of fact. A pass is work somebody is booked for; an ärende is a note on the
 * day that makes nobody unavailable and prints nowhere. Interleaving the two
 * would be the first step towards one being read as the other.
 *
 * There is no viewer clause in the select. RLS on personal_event returns the
 * owner's rows and the rows they were named on, and what comes back is drawn.
 * A client-side filter here would only mask the day the policy stopped
 * agreeing with it.
 *
 * Nothing is drawn at all on a day with none. An empty state under the shifts
 * would announce a feature on every day it is not being used.
 */
function DagArenden({
  date, tick, me, konton, onChanged,
}: {
  date: string;
  tick: number;
  me: string | null;
  konton: { id: string; name: string | null }[];
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<Handelse[]>([]);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const sb = getSupabase();
      const { data, error } = await sb
        .from("personal_event")
        .select(HANDELSE_COLUMNS)
        .eq("event_date", date);

      if (!live) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa dagens ärenden. Ladda om sidan."));
        setEvents([]);
        return;
      }

      setError(null);
      const rows = (data ?? []) as Handelse[];
      // All-day first, then by start. A day's shape should read the same every
      // time.
      rows.sort((a, b) =>
        Number(b.all_day) - Number(a.all_day) ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
        a.title.localeCompare(b.title, "sv"));
      setEvents(rows);

      // The list an owner edits, read back rather than remembered. A viewer
      // reading somebody else's ärende gets only their own row here, which is
      // the policy working -- the card falls back to "Delad med dig" for them.
      if (rows.length === 0) { setViewers({}); return; }
      const { data: vs } = await sb
        .from("personal_event_viewer")
        .select("event_id, account_id")
        .in("event_id", rows.map((r) => r.id));

      if (!live) return;
      const by: Record<string, string[]> = {};
      for (const v of vs ?? []) (by[v.event_id] ??= []).push(v.account_id);
      setViewers(by);
    })();
    return () => { live = false; };
  }, [date, tick]);

  async function remove(id: string) {
    setBusy(true); setError(null);
    // Viewer rows go with it: the foreign key is ON DELETE CASCADE, so the
    // list cannot outlive the ärende it describes.
    const { error } = await getSupabase().from("personal_event").delete().eq("id", id);
    if (error) setError(fel(error, "Ärendet kunde inte tas bort. Ladda om sidan."));
    setBusy(false);
    onChanged();
  }

  if (events.length === 0 && !error) return null;

  const nameOf = (id: string) => konton.find((k) => k.id === id)?.name ?? null;

  return (
    <div className="px-4 pt-[26px]" data-day-arenden={date}>
      <div
        className="px-1 pb-[10px] text-[12px] font-bold uppercase"
        style={{ letterSpacing: "1px", color: C.text2 }}
      >
        Ärenden
      </div>

      {error && <div className="pb-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <div className="flex flex-col gap-[10px]">
        {events.map((e) => (
          <EventCard
            key={e.id}
            event={e}
            mine={e.owner_id === me}
            viewerNames={(viewers[e.id] ?? [])
              .map((id) => nameOf(id))
              .filter((n): n is string => n !== null)}
            viewerCount={(viewers[e.id] ?? []).length}
            busy={busy}
            onDelete={() => void remove(e.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The day arrives as ?datum=. useSearchParams needs a Suspense boundary in a
 * statically exported app -- the query string is not known when the page is
 * prerendered, only when a browser opens it.
 *
 * Shape-checked before it is used. The value reaches a date input and a
 * where-clause, and anything that is not a date belongs in neither.
 */
function DagFromUrl() {
  const asked = useSearchParams().get("datum");
  return <Dag asked={asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Öppna dag" back="/"><span /></SoftScreen>}>
        <DagFromUrl />
      </Suspense>
    </AuthGate>
  );
}

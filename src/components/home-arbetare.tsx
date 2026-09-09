"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SoftNastaPass } from "./nasta-pass-card";
import { OfferStack, type Offer } from "./offer-stack";
import { GroupedList, SignOut, SoftSheet } from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, stockholmToday } from "@/lib/dates";
import { stampGate } from "@/lib/geo";

type Shift = {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  project_name: string;
  /** Geofenced against this. my_shift already carries it. */
  site_address: string | null;
  clock_in: string | null;
  clock_out: string | null;
};

type Note = { id: string; kind: string; work_date?: string };

/* ---------------------------------------------------------------------------
 * The design handoff, as values.
 *
 * Named rather than inlined at each use so a colour that appears in six places
 * is one string, and so a reader can check this block against the handoff
 * instead of hunting through markup. These are exact: the handoff is marked
 * high fidelity and the hexes come from it, not from an eyedropper.
 * ------------------------------------------------------------------------- */
const INK = "#091540";          // primary text, primary fill, icon strokes
const INK_HOVER = "#12206b";    // primary fill hover, "Neka" label
const ACCENT = "#1b2cc1";       // live dot, counts, duration, "Acceptera" fill
const TEXT_2 = "#4a5578";       // secondary copy, section labels, kickers
const CHEVRON = "#8b98c4";      // chevrons, inactive dot
const GROUND = "#f3f6fd";       // app background
const SURFACE = "#ffffff";      // cards
const PANEL = "#e7edfb";        // empty states, map ground, "Neka"
const HAIRLINE = "#e3eafb";     // row divider

const SHADOW_FLAT = "0 1px 3px rgba(9,21,64,.08)";
const SHADOW_GROUP = "0 4px 18px rgba(9,21,64,.07), 0 1px 2px rgba(9,21,64,.05)";
const SHADOW_HERO = "0 8px 28px rgba(9,21,64,.09), 0 1px 2px rgba(9,21,64,.05)";

/** #e7edfb, radius 14, 22px, centred, 15/500. Used by both empty states. */
function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[14px] p-[22px] text-center text-[15px] font-medium"
      style={{ background: PANEL, color: TEXT_2 }}
    >
      {children}
    </div>
  );
}

const Chevron = () => (
  <svg width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden>
    <path
      d="M1.5 1.5 7 7.5l-5.5 6"
      stroke={CHEVRON}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The arbetare's startsida.
 *
 * Clocking is the whole top of the screen because it is the only thing anyone
 * does standing in the rain with one glove off. Everything else can be two
 * presses away; this cannot be one.
 *
 * THE STAMP IS THE SERVER'S. clock_in() and clock_out() write now() in the
 * database and this screen sends no time at all -- a phone running ten minutes
 * fast would otherwise write ten minutes of error into evidence of hours
 * worked, and nobody would notice.
 *
 * The visual layer is the "Arbetare startsida" handoff, reproduced at the
 * values it specifies. Everything below the styling -- the query, the geofence
 * gate, the two RPCs, the offer responses -- is unchanged from before it.
 *
 * IT DRAWS ITS OWN TOP BAR rather than using AppBar, because the handoff's icon
 * buttons are a different shape and AppBar is shared with the admin screens,
 * which this redesign does not cover. Behind those buttons are soft.tsx's
 * bottom sheets, the same two the arbetsledare's startsida opens, and the
 * "Logga ut" inside one of them is the app's single SignOut.
 */
export function HomeArbetare() {
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  /** Waiting on the phone's position and the site's coordinates. */
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<"menu" | "profile" | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      const sb = getSupabase();
      const today = stockholmToday();

      // Yesterday too: the clocking window is soft, because a night shift ends
      // at 06:00 and bad signal on site is normal.
      const [{ data: shifts }, { data: offered }, { data: unread }] = await Promise.all([
        sb.from("my_shift")
          .select("id, work_date, start_time, end_time, project_name, site_address, clock_in, clock_out")
          .gte("work_date", addDays(today, -1))
          .lte("work_date", today)
          .order("work_date"),
        sb.from("my_offer").select("*").order("work_date"),
        sb.from("notification").select("id, kind, payload").is("read_at", null)
          .order("created_at", { ascending: false }),
      ]);

      if (!live) return;

      // The one to act on: a shift already running beats one not started, and
      // a day finished with is not offered a button at all.
      const rows = (shifts ?? []) as Shift[];
      const running = rows.find((s) => s.clock_in && !s.clock_out);
      const fresh = rows.find((s) => !s.clock_in && s.work_date === today);
      setShift(running ?? fresh ?? null);

      setOffers((offered ?? []) as Offer[]);
      setNotes((unread ?? []).map((n) => ({
        id: n.id,
        kind: n.kind,
        work_date: (n.payload as { work_date?: string } | null)?.work_date,
      })));
    })();

    return () => { live = false; };
  }, [reload]);

  /**
   * THE GEOFENCE, AND WHAT IT IS NOT.
   *
   * A 4 km check between the phone's own position and the site's address,
   * asked before the stamp and never after. It changes nothing about the
   * stamp itself: clock_in() and clock_out() still write the SERVER's now(),
   * this screen still sends no time, and a stamp that gets through is the same
   * stamp it always was.
   *
   * It lives in the browser, so it is a courtesy and not a boundary -- anyone
   * who wants to defeat it can. It is here to catch the honest mistake, the
   * one where somebody remembers at the kitchen table that they never stamped
   * out. The check that actually holds is invariant 3: the leader sees the
   * stamp and has the last word on it.
   *
   * `checking` is separate from `busy` so the button can say which of the two
   * waits it is in -- looking for the phone, or talking to the database.
   */
  async function stamp(dir: "in" | "out") {
    if (!shift || busy || checking) return;

    // Set before the first await. Geolocation can take seconds, and a second
    // tap in that window would ask twice and stamp twice.
    setChecking(true);
    setError(null);

    const gate = await stampGate(shift.site_address);
    setChecking(false);
    if (!gate.ok) { setError(gate.message); return; }

    setBusy(true);
    const { error } = await getSupabase()
      .rpc(dir === "in" ? "clock_in" : "clock_out", { p_tilldelning: shift.id });
    if (error) setError(error.message);
    setBusy(false);
    setReload((r) => r + 1);
  }

  async function respond(passId: string, take: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    const { error } = await getSupabase()
      .rpc(take ? "accept_offer" : "decline_offer", { p_pass: passId });

    if (error) {
      // Losing a race is normal here, so it is worded as a fact, not a fault.
      setNote(/full|not offered/i.test(error.message)
        ? "Någon annan hann först. Passet är taget."
        : error.message);
    } else if (take) {
      setNote("Passet är ditt.");
    } else {
      setNote("Passet ligger kvar under Öppna Pass om du ändrar dig.");
    }
    setBusy(false);
    setReload((r) => r + 1);
  }

  async function dismiss(id: string) {
    await getSupabase().from("notification")
      .update({ read_at: new Date().toISOString() }).eq("id", id);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  const clockedIn = Boolean(shift?.clock_in && !shift.clock_out);
  const front = offers?.[0] ?? null;
  const waiting = busy || checking;

  /** Filled variant. Ink when clocked in, accent when out -- handoff §2. */
  const primaryFill = clockedIn ? INK : ACCENT;
  const primaryShadow = clockedIn
    ? "0 6px 18px rgba(9,21,64,.26)"
    : "0 6px 18px rgba(27,44,193,.28)";

  return (
    <div
      data-screen="arbetare"
      className="mx-auto min-h-[844px] w-full max-w-[390px] pb-[40px]"
      style={{
        background: GROUND,
        color: INK,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* ---- 1. top bar, sticky ------------------------------------------ */}
      <div
        className="sticky top-0 z-[5] flex items-center justify-between gap-2 px-4 pb-[10px] pt-[14px]"
        style={{ background: "rgba(243,246,253,.88)", backdropFilter: "blur(12px)" }}
      >
        <button
          type="button"
          aria-label="Meny"
          aria-expanded={open === "menu"}
          onClick={() => setOpen("menu")}
          className="press-scale flex h-11 w-11 items-center justify-center rounded-[11px] p-0 transition-transform duration-[120ms] hover:bg-[#f0f5ff] active:scale-[.985] active:bg-[#dbe4f9]"
          style={{ background: SURFACE, boxShadow: SHADOW_FLAT }}
        >
          <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden>
            <path d="M1 1.5h18M1 7h18M1 12.5h18" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>

        <h1 className="text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
          Arbetare
        </h1>

        <button
          type="button"
          aria-label="Profil"
          aria-expanded={open === "profile"}
          onClick={() => setOpen("profile")}
          className="press-scale flex h-11 w-11 items-center justify-center rounded-[11px] p-0 transition-transform duration-[120ms] hover:bg-[#f0f5ff] active:scale-[.985] active:bg-[#dbe4f9]"
          style={{ background: SURFACE, boxShadow: SHADOW_FLAT }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="10" cy="6.4" r="3.4" stroke={INK} strokeWidth="2" />
            <path d="M3.6 17c.9-3.3 3.4-5 6.4-5s5.5 1.7 6.4 5" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Not in the handoff, which designs the happy path only. Kept in the
          same language: a panel, not a shout, because a stamp refused by the
          geofence is an ordinary answer and not a fault. */}
      {(error || note) && (
        <div className="px-4 pt-[6px]">
          <div
            className="rounded-[14px] p-[18px] text-[15px] font-medium"
            style={{ background: PANEL, color: error ? INK_HOVER : TEXT_2 }}
            role={error ? "alert" : "status"}
          >
            {error ?? note}
          </div>
        </div>
      )}

      {/* ---- 2. hero, the clock ------------------------------------------ */}
      <div className="px-4 pt-[6px]">
        <div
          className="relative rounded-[16px] px-5 pb-[18px] pt-5"
          style={{ background: SURFACE, boxShadow: SHADOW_HERO }}
        >
          {shift === undefined && (
            <p className="text-[15px] font-medium" style={{ color: TEXT_2 }}>Laddar…</p>
          )}

          {shift === null && (
            <p className="text-[15px] font-medium" style={{ color: TEXT_2 }}>
              Inget pass att stämpla just nu.
            </p>
          )}

          {shift && (
            <>
              {/*
                The dot is the ONLY status indicator -- the handoff removed the
                text on purpose. So it carries the label instead, or the one
                piece of state on this card would be invisible to a screen
                reader (handoff, Accessibility).
              */}
              <span
                role="status"
                aria-label={clockedIn ? "Instämplad" : "Inte instämplad"}
                className={`absolute right-5 top-5 block h-[9px] w-[9px] rounded-full ${
                  clockedIn ? "animate-livedot" : ""
                }`}
                style={
                  clockedIn
                    ? {
                        background: ACCENT,
                        boxShadow: "0 0 0 5px rgba(118,146,255,.20)",
                        animation: "livedot 2s ease-in-out infinite",
                      }
                    : { background: CHEVRON }
                }
              />

              <div
                className="mb-[2px] text-[15px] font-semibold"
                style={{ color: TEXT_2 }}
              >
                {shift.project_name}
              </div>
              <div
                className="mb-[18px] text-[34px] font-extrabold leading-[1.05]"
                style={{ letterSpacing: "-1.4px" }}
              >
                {hhmm(shift.start_time)}–{hhmm(shift.end_time)}
              </div>

              <button
                type="button"
                onClick={() => stamp(clockedIn ? "out" : "in")}
                disabled={waiting}
                aria-busy={waiting}
                className="press-scale flex h-[66px] w-full items-center justify-center rounded-[12px] text-[23px] font-extrabold text-white transition-[transform,background] duration-150 active:scale-[.985] disabled:opacity-60"
                style={{
                  letterSpacing: "-.5px",
                  background: primaryFill,
                  boxShadow: primaryShadow,
                }}
              >
                {checking
                  ? "Söker plats…"
                  : busy
                    ? "Stämplar…"
                    : clockedIn
                      ? "Stämpla Ut"
                      : "Stämpla In"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Notices the handoff does not draw, in its language rather than the
          old black-and-white one. */}
      {notes.map((n) => (
        <div key={n.id} className="px-4 pt-[14px]">
          <div
            className="rounded-[14px] p-[18px]"
            style={{ background: SURFACE, boxShadow: SHADOW_GROUP }}
          >
            <p className="mb-3 text-[15px] font-medium" style={{ color: TEXT_2 }}>
              {n.kind === "shift_deleted"
                ? `Ditt pass ${n.work_date ?? ""} är borttaget.`
                : n.kind === "pass_closed"
                  ? `Passet ${n.work_date ?? ""} är stängt.`
                  : "Du har en ny notis."}
            </p>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              className="press-scale h-[44px] w-full rounded-[10px] text-[15px] font-bold transition-transform duration-[120ms] active:scale-[.985]"
              style={{ background: PANEL, color: INK_HOVER }}
            >
              Okej
            </button>
          </div>
        </div>
      ))}

      {/* ---- 3. grouped nav ---------------------------------------------- */}
      <div className="px-4 pt-[14px]">
        <div
          className="overflow-hidden rounded-[14px]"
          style={{ background: SURFACE, boxShadow: SHADOW_GROUP }}
        >
          {[
            { href: "/mina-pass", label: "Mina Pass" },
            { href: "/min-kalender", label: "Arbetsdagar" },
          ].map((row, i) => (
            <div key={row.href}>
              {i > 0 && <div className="ml-[18px] h-px" style={{ background: HAIRLINE }} />}
              <Link
                href={row.href}
                className="flex h-[60px] items-center justify-between px-[18px] hover:bg-[#f6f9ff]"
                style={{ color: INK }}
              >
                <span className="text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
                  {row.label}
                </span>
                <Chevron />
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* ---- 4. nästa pass ------------------------------------------------ */}
      {/* The same card the arbetsledare gets, from the same component and the
          same rows. It was written here first; it lives in nasta-pass-card
          now so the two landing pages cannot drift apart. */}
      <div className="px-4 pt-[26px]">
        <SoftNastaPass />
      </div>

      {/* ---- 5. acceptera pass -------------------------------------------- */}
      <div className="px-4 pt-[26px]">
        <div className="flex items-baseline justify-between px-1 pb-[10px]">
          <div
            className="text-[12px] font-bold uppercase"
            style={{ letterSpacing: "1px", color: TEXT_2 }}
          >
            Acceptera pass
          </div>
          {offers && offers.length > 0 && (
            <div className="text-[12px] font-bold" style={{ color: ACCENT }}>
              {offers.length} till
            </div>
          )}
        </div>

        {offers === null && <EmptyPanel>Laddar…</EmptyPanel>}
        {offers !== null && !front && <EmptyPanel>Inga pass att svara på.</EmptyPanel>}

        {front && (
          <OfferStack
            offers={offers ?? []}
            busy={waiting}
            onRespond={respond}
          />
        )}
      </div>

      {/* ---- the two sheets ------------------------------------------------
          The handoff draws a menu as a bottom sheet, not a panel from the top:
          it opens where a thumb already is, and the home behind it stays
          legible under the scrim rather than being blacked out. All three
          landing pages open this same sheet now. */}
      {open === "menu" && (
        <SoftSheet onClose={() => setOpen(null)} label="Meny">
          {/* Mina Pass and Arbetsdagar are already grouped rows on the page
              itself, so the menu carries the one route that is not. */}
          <GroupedList rows={[{ href: "/oppna-pass", label: "Öppna Pass" }]} />
        </SoftSheet>
      )}

      {open === "profile" && (
        <SoftSheet onClose={() => setOpen(null)} label="Profil">
          <GroupedList rows={[{ href: "/konto", label: "Konto" }, { href: "/profil", label: "Profil" }]} />
          {/* One place signs out, whatever the screen around it looks like. */}
          <SignOut />
        </SoftSheet>
      )}
    </div>
  );
}

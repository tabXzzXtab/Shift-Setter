import type { Role } from "@/lib/account";
import type { TourSignal } from "./signal";
import { getSupabase } from "@/lib/supabase/client";
import { pendingDays } from "@/lib/pending-days";
import { addDays, stockholmToday } from "@/lib/dates";

/**
 * The first-launch tour, one sequence per role, as data.
 *
 * THREE KINDS OF STEP.
 *
 *   card      a white full screen. One sentence and "Nästa".
 *   nav       a white full screen saying what to do, then -- at "Visa mig" --
 *             the real screen with only a ring on the element. The person
 *             does the thing; the step waits for it.
 *   autofill  the same full screen, then the real form filled in by the tour
 *             a character at a time and a ring on the button. The person
 *             presses it, and the press is caught.
 *
 * NOTHING HERE WRITES, AND NOTHING THE TOUR ASKS FOR DOES EITHER -- with ONE
 * exception. Autofill sets what a form shows. A step whose button would write
 * -- Skapa projekt, Skapa pass, Bekräfta dagen, Acceptera, Stämpla In,
 * Generera Arbetsdagbok -- rings the real control and CATCHES the press
 * ("press", or "next" with `swallow`): the tour advances and the page never
 * sees it. Navigation taps go through.
 *
 * THE EXCEPTION IS A DAY ON MIN KALENDER (owner, 2026-10-06). Marking a day
 * the worker can work is the thing the step teaches, it creates no pass and
 * tells nobody anything, and a tour that swallowed it left the worker
 * believing they had booked a day they had not. That tap goes through, the
 * förval row is written, and the step ends on the calendar's own
 * "availability-saved" -- after the save, not on the tap.
 *
 * A STEP THAT CANNOT HAPPEN BECOMES A CARD. A first login usually has no offer
 * to accept, no day to confirm and no shift to stamp into, and a step waiting
 * for a tap on something that is not there would strand the person on it. So
 * a step can name a `requires`, checked against the database when it starts:
 * unmet, it is shown as a card carrying `otherwise`, or skipped when it has
 * none (the step after a fallback card usually has nothing left to add). A nav
 * step whose element never appears falls back to `missing` the same way. And
 * every nav and autofill step's full screen carries "Hoppa över", so nothing
 * traps anybody.
 *
 * Targets are found by what a person reads -- a button's name, a field's
 * label -- rather than by attributes added for the tour. The screens are
 * changing, and a tour that points by name keeps working through a restyle.
 */

export type Target =
  /** A link or button, by its accessible name: aria-label, else its text. */
  | { name: string | RegExp }
  /** A form control, by the text of the label that names it. */
  | { field: string }
  | { css: string }
  | { find: () => Element | null };

export type Requirement =
  | "has-project"
  | "has-leader"
  | "days-waiting"
  | "has-offer"
  | "has-confirmed-day"
  /** A shift today the worker has not stamped into yet -- what Stämpla In needs. */
  | "has-shift-to-stamp";

/** "pass-month" is not a form to fill but the day picker's month: a nav step
 *  can ask for it (`prepare`) so the days it rings are on screen. */
export type FormKey = "projekt" | "pass-month" | "pass-detail";

/**
 * The two days the leader's tour rings on Välj dagar: two weeks out and the
 * day after -- or the day before, when two weeks out is the last of a month,
 * so both are always on the same page of the calendar.
 */
export function tourDays(): [string, string] {
  const first = addDays(stockholmToday(), 14);
  const after = addDays(first, 1);
  return [first, after.slice(0, 7) === first.slice(0, 7) ? after : addDays(first, -1)];
}

type Gate = {
  requires?: Requirement;
  /** Shown as a card when `requires` is unmet. Absent: the step is skipped. */
  otherwise?: string;
};

export type NavStep = Gate & {
  type: "nav";
  image: TourImage;
  /**
   * The admin sandbox's last step: the caught press on Generera Arbetsdagbok
   * opens the sandbox's document on screen (sandbox.ts) before the step ends.
   * Never downloaded, never filed.
   */
  preview?: { text: string; em?: string; line: string };
  /** The pathname the element lives on. Elsewhere, the tour offers to go. */
  route: string;
  targets: Target[];
  /** Ring every target found, rather than the first one found. */
  all?: boolean;
  /** Empty for a step whose rings say it all: no tip, only Hoppa över. */
  tip: string;
  /** A form state the screen should take first -- the picker's month. */
  prepare?: FormKey;
  /**
   * What ends the step:
   *   "tap"    a real tap on a target, which still does what it does (navigation)
   *   "press"  a press on a target, CAUGHT before the page sees it -- the tour
   *            is frontend-only, so a button that would write is shown, not run
   *   "next"   a press on `swallow`, caught -- the step shows where things go,
   *            and the press that would have written is what moves it on
   *   a signal, or arriving on a route.
   */
  until: "tap" | "press" | "next" | TourSignal | { route: string };
  /** On a "next" step: controls on the page whose press must not go through. */
  swallow?: Target[];
  /** Card text when no target has appeared a few seconds after arriving. */
  missing: string;
  /** The full-screen sentence before "Visa mig", when `tip` is empty. */
  say?: string;
  /** The word or phrase in the sentence drawn in the brand colour. */
  em?: string;
};

export type AutofillStep = Gate & {
  type: "autofill";
  image: TourImage;
  route: string;
  /** In the order the screens show them: Skapa Pass is two screens. */
  forms: FormKey[];
  submit: Partial<Record<FormKey, Target>>;
  tip: Partial<Record<FormKey, string>>;
  /** "next": the tour shows how and moves on at a press on the ringed
   *  submit, which is caught -- nothing real is created. Every autofill step
   *  in the tour is this now: the tour writes nothing. */
  until: "next";
  /** The full-screen sentence before "Fyll i" starts the filling. */
  say: string;
  em?: string;
  /**
   * The card between the filled form and the ring on its button (Brilliant
   * 06, "Tryck Skapa projekt när allt stämmer."): the form has filled itself,
   * and this says what to press before the ring shows where.
   */
  after?: { text: string; em?: string; image: TourImage };
};

/** `em`: the word or phrase in the sentence drawn in the brand colour. */
export type CardStep = { type: "card"; image: TourImage; text: string; em?: string };

/**
 * The drawing in the middle of a step's full screen, from the brand images
 * (public/tour/<name>.png). Owner-chosen per step, 2026-10-06; no step shows
 * the same one as the step before it.
 */
export type TourImage =
  | "hjalm" | "hjalm-rund" | "ritning" | "roller" | "sele" | "sag"
  | "nyckel" | "tak" | "mejsel" | "murslev" | "hyvel";

export type Step = CardStep | NavStep | AutofillStep;

// ---------------------------------------------------------------------------

const ARBETSLEDARE: Step[] = [
  { type: "card", image: "hjalm", text: "Ditt företag har ett projekt som behöver folk.", em: "projekt" },
  { type: "card", image: "murslev", text: "Nu är det din tur att skapa ett pass.", em: "skapa ett pass" },
  {
    type: "nav",
    image: "mejsel",
    route: "/",
    targets: [{ name: "Skapa pass" }],
    tip: "Tryck på Skapa pass.",
    em: "Skapa pass",
    until: "tap",
    requires: "has-project",
    otherwise:
      "Skapa pass behöver ett projekt att lägga passen på. När ditt företag har ett projekt hittar du Skapa pass här på startsidan.",
    missing: "Skapa pass finns här på startsidan.",
  },
  { type: "card", image: "tak", text: "Välj de dagar du vill ha folk på plats.", em: "dagar" },
  {
    // NO TIP. Two rings on two days say what to do; the leader taps both, and
    // the step ends when both are chosen. The picker is paged to their month
    // first (prepare), so the rings are never on a page nobody is looking at.
    type: "nav",
    image: "sag",
    route: "/pass/ny",
    prepare: "pass-month",
    targets: [
      { find: () => document.querySelector(`[data-date="${tourDays()[0]}"]`) },
      { find: () => document.querySelector(`[data-date="${tourDays()[1]}"]`) },
    ],
    all: true,
    tip: "",
    say: "Tryck på två dagar i kalendern.",
    em: "två dagar",
    until: "tour-days-picked",
    requires: "has-project",
    missing: "Dagarna att välja visas här.",
  },
  { type: "card", image: "nyckel", text: "Bra. Nu fyller vi i detaljerna.", em: "detaljerna" },
  {
    type: "nav",
    image: "hyvel",
    route: "/pass/ny",
    targets: [{ name: "Fortsätt" }],
    tip: "Tryck på Fortsätt.",
    em: "Fortsätt",
    until: "tap",
    requires: "has-project",
    missing: "Fortsätt finns under kalendern.",
  },
  {
    // A SANDBOX STEP. The form is filled to show how a pass is made, and the
    // tour moves on at a press on the real button, ringed and swallowed, because
    // a pass created here would go out as real offers to real workers.
    type: "autofill",
    image: "roller",
    route: "/pass/ny",
    forms: ["pass-detail"],
    submit: { "pass-detail": { name: /^Skapa \d+ pass$/ } },
    tip: { "pass-detail": "Så här skapar du ett pass." },
    say: "Så här skapar du ett pass. Formuläret fyller i sig självt, och inget skapas.",
    em: "skapar du ett pass",
    until: "next",
    requires: "has-project",
  },
  {
    type: "card",
    image: "sele",
    text: "Arbetarna som är lediga kan nu se ditt pass. De väljer själva om de vill jobba den dagen.",
    em: "se ditt pass",
  },
  { type: "card", image: "sag", text: "När passen är över ska du kolla att allt som bokades stämmer.", em: "kolla att allt som bokades stämmer" },
  {
    type: "nav",
    image: "mejsel",
    route: "/",
    targets: [{ name: "Bekräfta pass" }],
    tip: "Tryck på Bekräfta pass.",
    em: "Bekräfta pass",
    until: "tap",
    requires: "days-waiting",
    otherwise: "Ingen dag att bekräfta än. När ett pass är över dyker det upp här.",
    missing: "Bekräfta pass finns högst upp på startsidan.",
  },
  {
    // NO AUTOFILL HERE. The hours on this screen are the leader's claim about
    // a real day, and confirming it is final (invariants 1 and 5). The tour
    // shows where they go and leaves every character of them to the leader.
    type: "nav",
    image: "ritning",
    route: "/bekrafta",
    targets: [{ field: "Timmar" }, { css: "#vad-vi-gjorde" }],
    all: true,
    tip: "Här skriver du hur många timmar var och en jobbade och vad ni gjorde. En bekräftad dag går inte att ändra.",
    em: "timmar",
    until: "next",
    swallow: [{ name: "Bekräfta dagen" }],
    requires: "days-waiting",
    missing: "Dagen du ska bekräfta visas här.",
  },
];

const ARBETARE: Step[] = [
  { type: "card", image: "tak", text: "Boka de dagar du kan jobba.", em: "dagar" },
  {
    type: "nav",
    image: "mejsel",
    route: "/",
    targets: [{ name: "Arbetsdagar" }],
    tip: "Tryck på Arbetsdagar.",
    em: "Arbetsdagar",
    until: "tap",
    missing: "Arbetsdagar finns här på startsidan.",
  },
  {
    type: "nav",
    image: "sag",
    route: "/min-kalender",
    targets: [{ find: () => document.querySelector("[data-date]")?.parentElement ?? null }],
    tip: "Tryck på en dag du kan jobba.",
    em: "dag",
    // Not "press": the tap must reach the calendar and SAVE (see the header).
    until: "availability-saved",
    missing: "Kalendern med dina arbetsdagar visas här.",
  },
  {
    type: "card",
    image: "roller",
    text: "När arbetsledaren skapar pass på de dagarna du bokat får du dem direkt.",
    em: "får du dem direkt",
  },
  {
    type: "card",
    image: "nyckel",
    text: "Har du inte förbokat? Inga problem. Du kan alltid välja från pass som fortfarande är lediga.",
    em: "lediga",
  },
  {
    type: "nav",
    image: "hyvel",
    route: "/",
    targets: [{ name: "Visa alla" }],
    tip: "Tryck på Visa alla för att se passen som är lediga.",
    em: "Visa alla",
    until: "tap",
    requires: "has-offer",
    otherwise:
      "Lediga pass visas under Acceptera pass på startsidan. Just nu finns inga som väntar på dig. När ett kommer ser du det där.",
    missing: "Lediga pass visas under Acceptera pass på startsidan.",
  },
  {
    type: "nav",
    image: "murslev",
    route: "/acceptera",
    targets: [{ name: "Acceptera" }],
    tip: "Tryck Acceptera på ett pass du vill ta.",
    em: "Acceptera",
    until: "press",
    requires: "has-offer",
    missing: "Passen du kan ta visas här.",
  },
  { type: "card", image: "sele", text: "På dagen, tryck in när du är på plats.", em: "på plats" },
  {
    // Steps 9 and 10 of the brief are one step: tapping Stämpla In IS
    // stamping in, and the step ends when the stamp is in the database -- a
    // tap refused by the 4 km check leaves the person here, told why.
    type: "nav",
    image: "hjalm",
    route: "/",
    targets: [{ name: "Stämpla In" }],
    tip: "Tryck Stämpla In när du är på plats.",
    em: "Stämpla In",
    until: "press",
    // Asked of the database up front. Without it a worker with no shift today
    // -- most of them, on a first login -- looked at an empty startsida for the
    // eight seconds MISSING_AFTER_MS waits for a button that never comes.
    requires: "has-shift-to-stamp",
    otherwise:
      "När du har ett pass idag visas Stämpla In högst upp på startsidan. Tryck på den när du är på plats. Det går när du är inom 4 km från arbetsplatsen.",
    missing:
      "När du har ett pass idag visas Stämpla In högst upp på startsidan. Tryck på den när du är på plats. Det går när du är inom 4 km från arbetsplatsen.",
  },
];

const ADMIN: Step[] = [
  {
    type: "card",
    image: "hjalm",
    text: "Allt börjar med ett projekt. Utan ett projekt finns det inget att jobba på.",
    em: "projekt",
  },
  {
    type: "nav",
    image: "ritning",
    route: "/",
    targets: [{ name: "Nytt projekt" }],
    tip: "Börja med att skapa ditt första projekt.",
    em: "första projekt",
    until: "tap",
    requires: "has-leader",
    otherwise:
      "Ett projekt behöver en arbetsledare som bekräftar dagarna. Skapa en arbetsledare under Alla Konton först. Sedan skapar du projektet med Nytt projekt på startsidan.",
    missing: "Nytt projekt finns högst upp på startsidan.",
  },
  {
    type: "autofill",
    image: "roller",
    route: "/projekt/ny",
    forms: ["projekt"],
    submit: { projekt: { name: "Skapa projekt" } },
    tip: {
      projekt: "Tryck Skapa projekt.",
    },
    // Said as the real thing, not "an example" (owner, 2026-10-06): the admin
    // should picture doing it for real. The press is still caught.
    say: "Så här skapar du ett projekt.",
    em: "skapar du ett projekt",
    after: { text: "Tryck Skapa projekt när allt stämmer.", em: "Skapa projekt", image: "murslev" },
    until: "next",
    requires: "has-leader",
  },
  { type: "card", image: "sele", text: "Din arbetsledare söker folk och lägger in passen.", em: "söker folk" },
  { type: "card", image: "sag", text: "Arbetarna väljer själva vilka pass de kan jobba.", em: "väljer själva" },
  { type: "card", image: "nyckel", text: "Arbetsledaren kollar att allt stämmer när dagarna är över.", em: "kollar att allt stämmer" },
  { type: "card", image: "tak", text: "Sista steget är ditt.", em: "ditt" },
  {
    // The link lives inside a project's row, so the row is the target until
    // it is open. The step ends on arriving at the page, however they got
    // there.
    type: "nav",
    image: "mejsel",
    route: "/",
    targets: [{ name: "Generera Arbetsdagbok" }, { css: "[data-project] > button" }],
    tip: "Öppna projektet och tryck Generera Arbetsdagbok.",
    em: "Generera Arbetsdagbok",
    until: { route: "/arbetsdagbok" },
    requires: "has-project",
    otherwise:
      "Arbetsdagboken skapas per projekt.",
    missing: "Dina projekt listas på startsidan under Alla projekt.",
  },
  {
    type: "nav",
    image: "hyvel",
    route: "/arbetsdagbok",
    targets: [{ name: "Generera Arbetsdagbok" }],
    tip: "Välj period och tryck Generera Arbetsdagbok.",
    em: "Generera Arbetsdagbok",
    until: "press",
    preview: {
      text: "Så här blir arbetsdagboken.",
      em: "arbetsdagboken",
      line: "Den visas bara här. Ingenting sparas och ingenting laddas ner.",
    },
    requires: "has-confirmed-day",
    otherwise:
      "Här genererar du Arbetsdagboken: välj projekt och period och tryck Generera Arbetsdagbok. Just nu finns inga bekräftade dagar att ta med. När arbetsledaren har bekräftat sina dagar gör du det här.",
    missing: "Generera Arbetsdagbok finns längst ner på den här sidan.",
  },
];

export const SEQUENCES: Record<Role, Step[]> = {
  admin: ADMIN,
  arbetsledare: ARBETSLEDARE,
  arbetare: ARBETARE,
};

export const DONE = {
  image: "hjalm-rund" as TourImage,
  // One sentence, as Brilliant draws it (Guide slutkort, canvas 1 Admin).
  title: "Välkommen till ByggKoll. Du vet nu vad du behöver göra.",
  em: "ByggKoll",
  line: undefined as string | undefined,
  button: "Kom igång",
};

// ---------------------------------------------------------------------------

/**
 * Whether a step can happen, asked of the database as the caller -- RLS
 * decides what "a project" means for a leader exactly as it does on the
 * screens the steps point at. A failed read counts as unmet: the card that
 * replaces the step is harmless, a step waiting on nothing is not.
 */
export async function met(req: Requirement): Promise<boolean> {
  const sb = getSupabase();
  try {
    switch (req) {
      case "has-project": {
        const { data } = await sb.from("project").select("id").limit(1);
        return (data ?? []).length > 0;
      }
      case "has-leader": {
        const { data } = await sb.from("arbetsledare_roster").select("id").limit(1);
        return (data ?? []).length > 0;
      }
      case "days-waiting":
        return (await pendingDays()).length > 0;
      case "has-offer": {
        // The same test the startsida uses for its one card: an unanswered
        // offer whose day has gone is still in my_offer, and is not one.
        const { data } = await sb
          .from("my_offer").select("pass_id").gte("work_date", stockholmToday()).limit(1);
        return (data ?? []).length > 0;
      }
      case "has-shift-to-stamp": {
        // The startsida's own test for drawing Stämpla In: a shift today with
        // no clock-in yet.
        const { data } = await sb
          .from("my_shift").select("id")
          .eq("work_date", stockholmToday()).is("clock_in", null).limit(1);
        return (data ?? []).length > 0;
      }
      case "has-confirmed-day": {
        const { data } = await sb
          .from("project_day").select("project_id").not("confirmed_at", "is", null).limit(1);
        return (data ?? []).length > 0;
      }
    }
  } catch {
    return false;
  }
}

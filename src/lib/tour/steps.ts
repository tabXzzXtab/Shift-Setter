import type { Role } from "@/lib/account";
import type { TourSignal } from "./signal";
import { getSupabase } from "@/lib/supabase/client";
import { pendingDays } from "@/lib/pending-days";
import { stockholmToday } from "@/lib/dates";

/**
 * The first-launch tour, one sequence per role, as data.
 *
 * THREE KINDS OF STEP.
 *
 *   card      a full-screen card over the blurred app. Text and "Nästa".
 *   nav       the real screen, one element ringed, a tooltip pointing at it.
 *             The person does the thing; the step waits for it.
 *   autofill  the real form, filled in by the tour a character at a time,
 *             then a tooltip at the button. The person presses it.
 *
 * NOTHING HERE WRITES. Autofill sets what a form shows; the submit is the
 * person's own press, and what it creates is as real as any other -- the tips
 * on those steps say so. Every step that waits for an action waits for the
 * action to SUCCEED (see signal.ts), never for the press.
 *
 * A STEP THAT CANNOT HAPPEN BECOMES A CARD. A first login usually has no offer
 * to accept, no day to confirm and no shift to stamp into, and a step waiting
 * for a tap on something that is not there would strand the person on it. So
 * a step can name a `requires`, checked against the database when it starts:
 * unmet, it is shown as a card carrying `otherwise`, or skipped when it has
 * none (the step after a fallback card usually has nothing left to add). A nav
 * step whose element never appears falls back to `missing` the same way. And
 * every nav and autofill step carries "Hoppa över", so nothing traps anybody.
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
  | "has-confirmed-day";

export type FormKey = "projekt" | "pass-days" | "pass-detail";

type Gate = {
  requires?: Requirement;
  /** Shown as a card when `requires` is unmet. Absent: the step is skipped. */
  otherwise?: string;
};

export type NavStep = Gate & {
  type: "nav";
  /** The pathname the element lives on. Elsewhere, the tour offers to go. */
  route: string;
  targets: Target[];
  /** Ring every target found, rather than the first one found. */
  all?: boolean;
  tip: string;
  /** "tap" on a target; a signal; or arriving on a route. */
  until: "tap" | TourSignal | { route: string };
  /** Card text when no target has appeared a few seconds after arriving. */
  missing: string;
};

export type AutofillStep = Gate & {
  type: "autofill";
  route: string;
  /** In the order the screens show them: Skapa Pass is two screens. */
  forms: FormKey[];
  submit: Partial<Record<FormKey, Target>>;
  tip: Partial<Record<FormKey, string>>;
  until: TourSignal;
};

export type CardStep = { type: "card"; text: string };

export type Step = CardStep | NavStep | AutofillStep;

// ---------------------------------------------------------------------------

const ARBETSLEDARE: Step[] = [
  { type: "card", text: "Ditt företag har ett projekt som behöver folk." },
  { type: "card", text: "Nu är det din tur att skapa ett pass." },
  {
    type: "nav",
    route: "/",
    targets: [{ name: "Skapa pass" }],
    tip: "Tryck på Skapa pass.",
    until: "tap",
    requires: "has-project",
    otherwise:
      "Skapa pass behöver ett projekt att lägga passen på. När ditt företag har ett projekt hittar du Skapa pass här på startsidan.",
    missing: "Skapa pass finns här på startsidan.",
  },
  {
    type: "autofill",
    route: "/pass/ny",
    forms: ["pass-days", "pass-detail"],
    submit: { "pass-days": { name: "Fortsätt" }, "pass-detail": { name: /^Skapa \d+ pass$/ } },
    tip: {
      "pass-days": "Vi har valt en dag om två veckor. Tryck här för att gå vidare.",
      "pass-detail": "Allt är ifyllt. Ändra det du vill och tryck här. Passet skapas på riktigt.",
    },
    until: "passes-created",
    requires: "has-project",
  },
  {
    type: "card",
    text: "Arbetarna som är lediga kan nu se ditt pass. De väljer själva om de vill jobba den dagen.",
  },
  { type: "card", text: "När passen är över ska du kolla att allt som bokades stämmer." },
  {
    type: "nav",
    route: "/",
    targets: [{ name: "Bekräfta pass" }],
    tip: "Tryck på Bekräfta pass.",
    until: "tap",
    requires: "days-waiting",
    otherwise:
      "Bekräfta pass är där du går igenom en dag som är över: vem som var på plats, hur många timmar var och en jobbade, och vad ni gjorde. Du har inga dagar att bekräfta än. När ett pass är över syns dagen på startsidan.",
    missing: "Bekräfta pass finns högst upp på startsidan.",
  },
  {
    // NO AUTOFILL HERE. The hours on this screen are the leader's claim about
    // a real day, and confirming it is final (invariants 1 and 5). The tour
    // shows where they go and leaves every character of them to the leader.
    type: "nav",
    route: "/bekrafta",
    targets: [{ field: "Timmar" }, { css: "#vad-vi-gjorde" }],
    all: true,
    tip: "Skriv hur många timmar var och en jobbade och vad ni gjorde. Tryck sedan Bekräfta dagen. En bekräftad dag går inte att ändra.",
    until: "day-confirmed",
    requires: "days-waiting",
    missing: "Dagen du ska bekräfta visas här.",
  },
];

const ARBETARE: Step[] = [
  { type: "card", text: "Boka de dagar du kan jobba." },
  {
    type: "nav",
    route: "/",
    targets: [{ name: "Arbetsdagar" }],
    tip: "Tryck på Arbetsdagar.",
    until: "tap",
    missing: "Arbetsdagar finns här på startsidan.",
  },
  {
    type: "nav",
    route: "/min-kalender",
    targets: [{ find: () => document.querySelector("[data-date]")?.parentElement ?? null }],
    tip: "Tryck på en dag du kan jobba. Den sparas direkt.",
    until: "availability-saved",
    missing: "Kalendern med dina arbetsdagar visas här.",
  },
  {
    type: "card",
    text: "När arbetsledaren skapar pass på de dagarna du bokat får du dem direkt.",
  },
  {
    type: "card",
    text: "Har du inte förbokat? Inga problem. Du kan alltid välja från pass som fortfarande är lediga.",
  },
  {
    type: "nav",
    route: "/",
    targets: [{ name: "Visa alla" }],
    tip: "Tryck på Visa alla för att se passen som är lediga.",
    until: "tap",
    requires: "has-offer",
    otherwise:
      "Lediga pass visas under Acceptera pass på startsidan. Just nu finns inga som väntar på dig. När ett kommer ser du det där.",
    missing: "Lediga pass visas under Acceptera pass på startsidan.",
  },
  {
    type: "nav",
    route: "/acceptera",
    targets: [{ name: "Acceptera" }],
    tip: "Tryck Acceptera på ett pass du vill ta. Det blir ditt på riktigt.",
    until: "offer-accepted",
    requires: "has-offer",
    missing: "Passen du kan ta visas här.",
  },
  { type: "card", text: "På dagen, tryck in när du är på plats." },
  {
    // Steps 9 and 10 of the brief are one step: tapping Stämpla In IS
    // stamping in, and the step ends when the stamp is in the database -- a
    // tap refused by the 4 km check leaves the person here, told why.
    type: "nav",
    route: "/",
    targets: [{ name: "Stämpla In" }],
    tip: "Tryck Stämpla In när du är på plats.",
    until: "stamped-in",
    missing:
      "När du har ett pass idag visas Stämpla In högst upp på startsidan. Tryck på den när du är på plats. Det går när du är inom 4 km från arbetsplatsen.",
  },
];

const ADMIN: Step[] = [
  {
    type: "card",
    text: "Allt börjar med ett projekt. Utan ett projekt finns det inget att jobba på.",
  },
  {
    type: "nav",
    route: "/",
    targets: [{ name: "Nytt projekt" }],
    tip: "Tryck på Nytt projekt.",
    until: "tap",
    requires: "has-leader",
    otherwise:
      "Ett projekt behöver en arbetsledare som bekräftar dagarna. Skapa en arbetsledare under Alla Konton först. Sedan skapar du projektet med Nytt projekt på startsidan.",
    missing: "Nytt projekt finns högst upp på startsidan.",
  },
  {
    type: "autofill",
    route: "/projekt/ny",
    forms: ["projekt"],
    submit: { projekt: { name: "Skapa projekt" } },
    tip: {
      projekt: "Allt är ifyllt med exempel. Ändra det du vill och tryck Skapa projekt. Projektet skapas på riktigt.",
    },
    until: "project-created",
    requires: "has-leader",
  },
  { type: "card", text: "Din arbetsledare söker folk och lägger in passen." },
  { type: "card", text: "Arbetarna väljer själva vilka pass de kan jobba." },
  { type: "card", text: "Arbetsledaren kollar att allt stämmer när dagarna är över." },
  { type: "card", text: "Sista steget är ditt." },
  {
    // The link lives inside a project's row, so the row is the target until
    // it is open. The step ends on arriving at the page, however they got
    // there.
    type: "nav",
    route: "/",
    targets: [{ name: "Generera Arbetsdagbok" }, { css: "[data-project] > button" }],
    tip: "Öppna projektet och tryck Generera Arbetsdagbok.",
    until: { route: "/arbetsdagbok" },
    requires: "has-project",
    otherwise:
      "Arbetsdagboken genereras per projekt. När du har ett projekt öppnar du det på startsidan och trycker Generera Arbetsdagbok.",
    missing: "Dina projekt listas på startsidan under Alla projekt.",
  },
  {
    type: "nav",
    route: "/arbetsdagbok",
    targets: [{ name: "Generera Arbetsdagbok" }],
    tip: "Välj period och tryck Generera Arbetsdagbok.",
    until: "arbetsdagbok-generated",
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
  title: "Välkommen till ByggKoll.",
  line: "Du vet nu vad du behöver göra.",
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

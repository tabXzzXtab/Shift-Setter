import type { DocPayload } from "@/lib/doc/arbetsdagbok";
import { addDays, stockholmToday } from "@/lib/dates";

/**
 * THE ADMIN TOUR'S SANDBOX (owner, 2026-10-06): everything the guide needs to
 * show, as data in this file -- never read from the database, never written
 * to it.
 *
 * A first admin has no arbetsledare, no project, no confirmed day and, since
 * the guide now comes BEFORE "Ställ in ditt företag", no company details
 * either. Every one of those used to turn a step into an explanation card or
 * skip it. In the sandbox they are all here: the project the admin "creates"
 * in step 3 appears on the startsida, opens Arbetsdagbok, and generates a
 * document from two worked days -- on screen only. The guide still catches
 * every press that would write (tour-provider.tsx), so nothing is created.
 *
 * The values are the ones the autofill types into Skapa ett projekt, so the
 * project the admin watched being made is the one they then document.
 */
export const SANDBOX_PROJECT = {
  id: "00000000-0000-4000-8000-00000000f45a",
  name: "Fasad Malmö",
  site_address: "Storgatan 12, 211 34 Malmö",
  bestallare_bolag: "Storgatans Fastigheter AB",
  bestallare_address: "Södra Förstadsgatan 4, 211 43 Malmö",
  bestallare_orgnr: "556000-0000",
} as const;

/** The arbetsledare the example project is given, when the company has none. */
export const SANDBOX_LEADER = { id: "00000000-0000-4000-8000-0000000001ed", name: "Lena Ledare" } as const;

/** The document the guide shows: on screen only, never downloaded, never filed. */
export function sandboxPayload(): DocPayload {
  // Two worked days last week, Monday and Tuesday, so they are always past.
  const today = stockholmToday();
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;   // Monday 0
  const monday = addDays(today, -weekday - 7);
  const tuesday = addDays(monday, 1);
  const gjorde1 = "Ställning rest längs gatusidan och gammal puts knackad ned på plan ett.";
  const gjorde2 = "Ny grundputs på plan ett och fönsterbleck monterade.";
  return {
    cover: {
      adress: SANDBOX_PROJECT.bestallare_address,
      bolag: SANDBOX_PROJECT.bestallare_bolag,
      orgnr: SANDBOX_PROJECT.bestallare_orgnr,
      project: SANDBOX_PROJECT.name,
    },
    sender: {
      name: "Ditt Företag AB",
      orgnr: "556000-0000",
      address: "Exempelvägen 1, 123 45 Exempelstad",
      contact: "Ditt namn",
      phone: "070-000 00 00",
      bankgiro: null,
      momsreg: null,
      fSkatt: true,
      logo: null,
      logoFailed: false,
    },
    days: [
      {
        date: monday,
        rows: [
          { arbetare: "Anna Andersson", hours: "7,5", passTider: "07:00–16:00", vadViGjorde: gjorde1 },
          { arbetare: "Erik Berg", hours: "7,5", passTider: "07:00–16:00", vadViGjorde: gjorde1 },
          { arbetare: SANDBOX_LEADER.name, hours: "8", passTider: "06:45–16:15", vadViGjorde: gjorde1 },
        ],
      },
      {
        date: tuesday,
        rows: [
          { arbetare: "Anna Andersson", hours: "8", passTider: "07:00–16:30", vadViGjorde: gjorde2 },
          { arbetare: "Erik Berg", hours: "6,5", passTider: "07:00–14:00", vadViGjorde: gjorde2 },
          { arbetare: SANDBOX_LEADER.name, hours: "8,5", passTider: "06:45–16:45", vadViGjorde: gjorde2 },
        ],
      },
    ],
  };
}

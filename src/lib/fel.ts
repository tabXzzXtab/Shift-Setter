/**
 * What a refusal says to the person who hit it.
 *
 * THE DATABASE IS THE ONLY REAL BOUNDARY (CLAUDE.md), so almost every refusal
 * in this app arrives as a Postgres exception written for whoever was reading
 * the migration -- in English, naming a column or a stage. That is the right
 * text in a log and the wrong text on a phone on a building site.
 *
 * Every message here answers two questions, because a refusal that answers
 * only the first leaves the reader stuck:
 *
 *   WHAT HAPPENED -- in the app's own words, not the schema's.
 *   WHO CAN FIX IT -- the admin, the arbetsledare, or the reader themselves.
 *
 * ONE TABLE, NOT ONE PER SCREEN. Three screens had grown their own partial
 * saySwedish(), which meant the same refusal read differently depending on
 * where you met it, and a rule added to the database was translated on
 * whichever screen someone happened to be working on. The database raises one
 * sentence; the app should say one thing back.
 *
 * WHAT IS DELIBERATELY NOT TRANSLATED: nothing is left in English, but not
 * everything gets a specific sentence. A refusal nobody anticipated falls back
 * to the caller's own context line -- "Passet kunde inte skapas" -- which says
 * what failed and who to ask, without inventing a reason it does not know.
 * A friendly guess about which rule fired would be worse than the honest
 * shrug: it would send the reader to fix the wrong thing.
 */

/** Anything that can arrive in a catch or a PostgREST result. */
type Felkalla = { message?: unknown } | string | null | undefined;

function textOf(e: Felkalla): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof e.message === "string") return e.message;
  return "";
}

/**
 * Matcher -> Swedish. Ordered: the first hit wins, so a narrow phrase must sit
 * above the broader one it would otherwise be swallowed by.
 *
 * Matching is on a DISTINCTIVE FRAGMENT rather than the whole sentence,
 * because most of these carry runtime values -- a date, a name, a count --
 * substituted into a `%` at raise time.
 */
const TABLE: [string, string][] = [
  // ---- the connection, the session, the login -----------------------------
  ["Invalid login credentials", "Fel e-post eller lösenord. Kontrollera och försök igen."],
  ["Email not confirmed", "Kontot är inte bekräftat än. Be administratören aktivera det."],
  ["User already registered", "Det finns redan ett konto med den e-postadressen."],
  ["Password should be", "Lösenordet är för kort. Välj minst sex tecken."],
  ["JWT expired", "Din inloggning har gått ut. Logga in igen."],
  ["Invalid Refresh Token", "Din inloggning har gått ut. Logga in igen."],
  ["Failed to fetch", "Ingen kontakt med servern. Kontrollera nätet och försök igen."],
  ["NetworkError", "Ingen kontakt med servern. Kontrollera nätet och försök igen."],

  // The onboarding PIN gate, refused by verify-pin's attempt ceiling rather
  // than by Postgres. It is here and not in the page because the gate has two
  // ceilings -- one per caller, one across everybody -- and they say the same
  // sentence deliberately: a salesperson turned away while somebody else is
  // hammering the door has the same thing to do about it as one who mistyped
  // six times, which is wait a minute. Telling them which ceiling they hit
  // would only tell them whether an attack was under way.
  ["too many attempts", "För många försök. Försök igen om en minut."],

  // A policy that cannot run its own helper is a broken deployment, not
  // something the reader did. Say so rather than blaming them.
  ["permission denied for function", "Något är fel i behörigheterna. Kontakta administratören."],
  ["permission denied for schema", "Något är fel i behörigheterna. Kontakta administratören."],
  // A guard that refused the CALLER rather than a deployment that is broken.
  ["insufficient_privilege", "Du har inte behörighet att göra det här. Kontakta administratören."],
  ["permission denied", "Du har inte behörighet att göra det här. Kontakta administratören."],

  // ---- who may do what ----------------------------------------------------
  ["only an admin deletes a project", "Bara en administratör kan ta bort ett projekt."],
  ["only an admin may delete a shift", "Bara en administratör kan ta bort ett pass."],
  ["only an admin creates a Snabb Pass", "Bara en administratör kan skapa ett snabbpass."],
  ["only an admin generates the Arbetsdagbok", "Bara en administratör kan skapa arbetsdagboken."],
  ["only an admin swaps two arbetsledare", "Bara en administratör kan byta plats på två arbetsledare."],
  ["only an admin runs a bristsurvey", "Bara en administratör kan göra en bristsurvey."],
  ["only an admin completes a bristsurvey", "Bara en administratör kan göra en bristsurvey."],
  ["only an admin lets a day run without an arbetsledare",
   "Bara en administratör kan låta en dag köras utan arbetsledare."],
  ["only an admin may change name, email",
   "Namn, e-post och borttagning ändras av administratören."],
  ["only the admin reviews a confirmed day",
   "Bara en administratör kan godkänna eller underkänna en bekräftad dag."],
  ["Endast administratören kan stänga ett pågående pass.",
   "Bara en administratör kan stänga ett pågående pass."],
  ["this is the last active admin",
   "Det här är den sista aktiva administratören. Gör någon annan till administratör först, sedan går kontot att pausa, ändra eller ta bort."],
  ["only an arbetsledare can be responsible for a project",
   "Bara en arbetsledare kan vara ansvarig för ett projekt."],
  ["that is not an arbetsledare", "Personen är inte arbetsledare."],
  ["both sides of a swap must be an arbetsledare", "Båda sidor av ett byte måste vara arbetsledare."],
  ["only a leader may change a clock stamp",
   "Bara arbetsledaren kan ändra en stämpling."],
  ["only an arbetsledare assigned to this project",
   "Bara arbetsledaren på projektet kan skriva timmar eller sena ankomster."],
  ["only an arbetsledare on this project that day",
   "Bara arbetsledaren som stod på dagen kan skriva timmar eller sena ankomster."],
  ["only the arbetsledare who held day",
   "Dagen bekräftas av arbetsledaren som stod på den. Administratören fyller luckor genom bristsurveyn."],
  ["only the arbetsledare assigned to this project may confirm",
   "Dagen bekräftas av projektets arbetsledare. Administratören fyller luckor genom bristsurveyn."],
  ["a flagged day is confirmed by the admin and nobody else",
   "En flaggad dag bekräftas bara av administratören."],
  ["ran without an arbetsledare; admin and only admin confirms it",
   "Dagen kördes utan arbetsledare. Bara administratören kan bekräfta den."],
  ["only an arbetare can be hand-picked",
   "Bara arbetare kan handplockas. Arbetsledaren läggs på dagen automatiskt."],

  // ---- confirmation, and its finality -------------------------------------
  ["Dagen är godkänd och låst. Den kan inte ändras.",
   "Dagen är godkänd och låst. Den kan inte ändras."],
  ["is admin_confirmed and final; its times cannot move",
   "Dagen är godkänd och låst. Tiderna kan inte ändras."],
  ["admin_confirmed and final",
   "Dagen är godkänd och låst. Den kan inte ändras."],
  ["stage 1 is final -- only the admin edits it",
   "Dagen är bekräftad. Bara administratören kan ändra den nu."],
  ["stage 1 is final -- only the admin reviews it",
   "Dagen är bekräftad. Bara administratören kan granska den nu."],
  ["is confirmed and final; no edits after",
   "Dagen är bekräftad och kan inte ändras."],
  ["only a day the arbetsledare has confirmed can be approved",
   "Dagen är inte bekräftad av arbetsledaren än. Den kan inte godkännas."],
  ["only a day the arbetsledare has confirmed can be sent back",
   "Dagen är inte bekräftad av arbetsledaren än. Den kan inte skickas tillbaka."],
  ["a rejected day needs a note saying what is wrong",
   "Skriv varför dagen skickas tillbaka. Arbetsledaren ser texten."],

  // ---- Snabb Pass, and the day it may file itself -------------------------
  //
  // THESE ARRIVE ALREADY IN SWEDISH, and are translated anyway. The raises
  // carry runtime values -- a count, a date, a list of names -- and a fixed
  // table entry cannot reproduce them, so what lands here is the sentence
  // without its numbers. That is the right trade: the screen gates on the same
  // four rules with the live figures in hand and says so BEFORE the admin
  // presses anything. What reaches this table is the backstop firing, and a
  // backstop that says the right thing plainly beats one that says nothing
  // because nobody wrote it an entry. (The locked-day refusal below has been
  // falling through to a generic fallback since it was written, for exactly
  // that reason.)
  ["och den dagen är redan bekräftad och låst",
   "Personen har ett pass som krockar, och den dagen är redan bekräftad och låst. "
   + "Ändra tiderna eller välj någon annan."],
  ["En dag med fler personer på bekräftas av arbetsledaren",
   "Det står redan pass på projektet den dagen. En dag som fler personer arbetar på "
   + "bekräftas av arbetsledaren — stäng av \"Generera arbetsdagbok direkt\"."],
  ["Ett pass kan bara föras rakt in i arbetsdagboken i efterhand",
   "Dagen har inte varit än. Välj dagens datum eller tidigare, eller stäng av "
   + "\"Generera arbetsdagbok direkt\"."],
  ["Dagen behöver en beskrivning av vad som gjordes",
   "Fyll i \"Vad vi gjorde\". Utan den kan dagen inte föras in i arbetsdagboken."],
  ["Timmar saknas för",
   "Någon på dagen saknar timmar. Varje person behöver en siffra innan dagen förs "
   + "in i arbetsdagboken."],
  ["has not happened yet; a Snabb Pass cannot file it in advance",
   "Dagen har inte varit än. Arbetsdagboken beskriver arbete som är utfört."],
  ["only an admin files a Snabb Pass day",
   "Bara administratören kan föra in ett snabbpass i arbetsdagboken."],
  ["it is confirmed as what it was, not as a Snabb Pass",
   "Dagen kördes utan arbetsledare och bekräftas som en flaggad dag, inte som ett snabbpass."],
  ["a day cannot be approved with no account of what was done",
   "Dagen saknar beskrivning av vad som gjordes. Fyll i den innan du godkänner."],
  ["the day needs an account of what was done",
   "Skriv vad ni gjorde. Texten skrivs ut på varje rad i arbetsdagboken."],
  ["is not over yet; its last shift ends",
   "Dagen är inte slut än. Den kan bekräftas när sista passet har slutat."],
  ["still have no confirmed hours",
   "Alla på dagen har inte fått timmar än. Fyll i dem innan du bekräftar."],
  ["no shifts on", "Det finns inga pass den dagen på det här projektet."],
  ["stage 2 reviews a confirmation; it cannot rewrite whose it was",
   "Granskningen kan inte skriva om vems bekräftelsen var."],
  ["a confirmed day must record how it was confirmed",
   "Något gick fel när dagen bekräftades. Kontakta administratören."],
  ["is not flagged as", "Dagen är inte flaggad på det sättet och kan inte bekräftas som det."],
  ["that day is not waiting as a flagged day", "Dagen väntar inte som en flaggad dag."],

  // ---- the shift, and who stands on it ------------------------------------
  ["that person already works", "Personen är redan bokad på ett pass som krockar i tid. Välj någon annan, eller ändra tiderna."],
  ["is full (", "Passet är redan fullt. Ingen mer plats finns kvar."],
  ["this shift is not offered to you", "Passet erbjuds inte längre till dig."],
  ["not your shift, already clocked in, or no longer assigned",
   "Du kan inte stämpla in på det här passet. Prata med din arbetsledare."],
  ["not your shift, not clocked in, or already clocked out",
   "Du kan inte stämpla ut från det här passet. Prata med din arbetsledare."],
  ["that person is not on this shift", "Personen står inte på det här passet."],
  ["and is not re-offered it; use a Snabb Pass",
   "Personen har tagits bort från passet och erbjuds det inte igen. Lägg till dem med ett snabbpass."],
  ["clock stamp originals are append-only evidence",
   "Den ursprungliga stämplingen är ett bevis och kan inte ändras."],
  ["an arbetsledare is not removed this way; a replacement must be chosen",
   "En arbetsledare avbokas inte så här. Välj en ersättare i stället."],
  ["an arbetsledare is free that day; one of them takes it before a worker does",
   "En arbetsledare är ledig den dagen och tar passet före en arbetare."],
  ["that arbetsledare is already working that day", "Arbetsledaren jobbar redan den dagen."],
  ["that arbetsledare is already off this day", "Arbetsledaren står inte på den här dagen."],
  ["a swap is two arbetsledare trading the SAME day", "Ett byte gäller samma dag för båda arbetsledarna."],
  ["that is the same arbetsledare on both sides", "Det är samma arbetsledare på båda sidor."],
  ["both are already on that project; there is nothing to trade",
   "Båda är redan på det projektet. Det finns inget att byta."],
  ["one of them already leads the other", "Den ena leder redan den andres projekt."],
  ["one of those days is already given up", "En av dagarna är redan uppgiven."],

  // ---- deleting and closing -----------------------------------------------
  ["project has active passes with workers assigned",
   "Projektet har pass med bokad personal framåt i tiden. Avboka dem först, eller låt projektet ligga kvar."],
  ["project is already deleted", "Projektet är redan borttaget."],
  ["a project records who created it; that cannot be changed",
   "Vem som skapade projektet kan inte ändras."],
  ["project is deleted; it cannot produce a document",
   "Projektet är borttaget och kan inte producera någon arbetsdagbok."],
  ["this shift has started and cannot be deleted",
   "Passet har redan börjat. Det tas inte bort — det bekräftas."],
  ["someone has clocked in on this shift; it cannot be deleted",
   "Någon har stämplat in på passet. Det kan inte tas bort."],
  ["a confirmed day cannot be deleted", "Dagen är bekräftad och kan inte tas bort."],
  ["shifts are soft-deleted", "Passet kan inte tas bort så här. Kontakta administratören."],
  ["Passet har inte börjat än. Ta bort det i stället.",
   "Passet har inte börjat än. Ta bort det i stället för att stänga det."],
  ["Passet är redan slut. Det bekräftas i stället.",
   "Passet är redan slut. Det bekräftas i stället för att stängas."],
  ["Passet finns inte, eller är redan borttaget.", "Passet finns inte, eller är redan borttaget."],
  ["Ange hur många timmar passet har jobbat.", "Ange hur många timmar passet har jobbat."],

  // ---- the document -------------------------------------------------------
  ["no shifts in the chosen range", "Det finns inga pass i den valda perioden. Det finns inget att dokumentera."],
  ["are not confirmed; complete the bristsurvey",
   "Alla dagar i perioden är inte bekräftade. Gör bristsurveyn först."],
  ["have no \"Vad Vi Gjorde\" description",
   "Några dagar saknar beskrivning av vad som gjordes. Gör bristsurveyn först."],
  ["the bestallare block is incomplete",
   "Beställaruppgifterna är ofullständiga. Fyll i dem på projektet innan du skapar dokumentet."],
  ["the clock span for", "Stämplingarna på dagen ger ett orimligt antal timmar. Rätta dem innan du surveyar dagen."],

  // ---- things that should not happen, said plainly ------------------------
  ["no such project", "Projektet finns inte."],
  ["no such shift, or it is already deleted", "Passet finns inte, eller är redan borttaget."],
  ["no such shift", "Passet finns inte."],
  ["no such assignment", "Bokningen finns inte."],
  ["no such worker", "Personen finns inte."],
  ["no such batch", "Serien finns inte."],
  ["does not exist", "Det du försökte ändra finns inte längre."],
  ["no worker record for this account", "Kontot saknar en arbetarprofil. Kontakta administratören."],
  ["not your project", "Projektet är inte ditt."],

  // ---- ärenden, which are not shift data ----------------------------------
  //
  // MATCHED ON THE CONSTRAINT NAME, not on a raise. These three are CHECK
  // constraints, so what arrives is Postgres's own sentence with the
  // constraint's name quoted inside it -- and the name is the only part of it
  // that says which rule fired. Above the generic "violates check constraint"
  // line for that reason: the broad entry would otherwise swallow all three
  // and answer "Uppgifterna går inte ihop" to three different questions.
  ["personal_event_title_not_blank", "Ärendet behöver en titel."],
  ["personal_event_times_match_all_day",
   "Ett ärende är antingen hela dagen, eller har både starttid och sluttid med "
   + "sluttiden efter starttiden."],
  ["personal_event_colour_in_palette", "Den färgen finns inte. Välj en av de åtta."],

  // One company, one tenancy. Above the generic duplicate-key line, which
  // would otherwise answer "Det finns redan en post med de uppgifterna" to a
  // salesperson onboarding a customer -- true, and no use at all. create-tenant
  // says this in its own words in the ordinary case; this is the sentence for
  // the race it cannot win, where the constraint is what refuses.
  ["tenant_org_nr_key", "Det finns redan ett företag med det organisationsnumret."],

  // ---- generic Postgres, last ---------------------------------------------
  ["duplicate key value", "Det finns redan en post med de uppgifterna."],
  ["violates foreign key constraint", "Något det här hänger ihop med finns inte längre. Ladda om sidan."],
  ["violates check constraint", "Uppgifterna går inte ihop. Kontrollera fälten och försök igen."],
  ["violates not-null constraint", "Ett obligatoriskt fält är tomt."],
];

/**
 * The Swedish for a refusal, or the caller's own line when it is one nobody
 * anticipated.
 *
 * `fallback` is the screen's sentence for "this particular thing did not
 * work", and it should name the ACT and the person to ask -- "Passet kunde
 * inte skapas. Kontakta administratören." It is not a default to be shared;
 * a screen that cannot say which act failed has not been given one.
 */
/**
 * What a tenancy that has run out is told.
 *
 * A CONSTANT RATHER THAN A TABLE ROW, and the difference is the point. Every
 * other sentence in this file translates something Postgres RAISED. Expiry
 * raises nothing: app.current_tenant_id() returns NULL, in_tenant() coalesces
 * that to false, and the tenancy simply reads empty. There is no error text to
 * match on, so a matcher here would be a line that can never fire.
 *
 * It lives in this file anyway because this is where the app keeps what it
 * says when it turns somebody away, and a sentence about money kept in a
 * component is one nobody else can find. <Utgangen> imports it.
 *
 * "Kontakta oss" is the operator, which is why a super admin who has entered a
 * client keeps their access past the date -- the instruction has to be
 * followable from the other end.
 */
export const UTGANGEN =
  "Din provperiod har gått ut. Kontakta oss för att fortsätta använda ByggKoll.";

export function fel(error: unknown, fallback: string): string {
  const raw = textOf(error as Felkalla).trim();
  if (raw === "") return fallback;

  for (const [needle, swedish] of TABLE) {
    if (raw.includes(needle)) return swedish;
  }
  return fallback;
}

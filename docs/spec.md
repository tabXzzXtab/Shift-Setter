# Shift System — Ground-Up Inventory

Everything known about this system, stated without reference to any existing code, table, or migration. This is the seed document for a clean rebuild.

---

## 0. What this business actually does

A Swedish construction and service company. Work happens at **projects** — physical sites with addresses, running for open-ended durations with no fixed end date. **Workers** are sent to those sites for **shifts**. The company is legally required to hold a record of hours worked. That record is the **Arbetsdagbok**, and producing it correctly is the reason the entire system exists.

Everything downstream of that: the scheduling, the clocking, the confirmations, the priority lists — all of it exists to make one document accurate and defensible.

**Black and white until it works.** No colour, no styling, no visual polish anywhere in the application until every function is proven. Design comes last. The one exception is the calendar — drag-to-paint needs a real layout to be usable at all, so it gets built properly from the start, still in black and white.

**Build it so a child could use it.** Large targets, obvious affordances, one action per screen where possible. Someone who can barely read should be able to open this and understand what to press. That is a functional requirement, not an aesthetic one.

**Mobile first, always.** This system is used on phones — by workers on site, by leaders between jobs. Every screen is designed for a phone and then adapted upward to desktop, never the reverse. A layout that works on a wide screen and is squeezed down will fail the people who actually use it.

**Design direction: build backwards from the Arbetsdagbok.** Section 1 defines what the document needs. Everything after it exists to fill those cells.

---

## 1. The Arbetsdagbok — the output contract

DocMaker was a standalone Windows application that produced this document by hand-typing. Its template moves into the app; the app renders the same layout from database data and the admin exports the PDF. There is no file-format contract to satisfy — only the layout.

### Page 1 — the cover. Always this layout, nothing else on it.

| Element | Source |
|---|---|
| Logo, title "Arbetsdagbok" | Fixed |
| Skapad: timestamp | Generated at export |
| **Beställare** — Adress, Bolag, Org nummer | Project, captured at creation. All three always printed. No toggles. |
| **Project:** | Project name |
| **Ordinarie tid: Xh** | Sum of all confirmed hours in the document's date range |
| GODKÄND AV | Fixed heading |
| Ort & datum: ______ | **Always blank.** Signed by hand. |
| Signatur: ______ | **Always blank.** Signed by hand. |
| Footer | Fixed. See below. |

Only four values are filled on the cover: Adress, Bolag, Org nummer, Project. Ordinarie tid is computed. Everything else is fixed or deliberately blank.

The beställare block always prints in full — the document exists so the customer can see how many hours were worked on their job, so it cannot identify them incompletely.

### Page 2 onward — the day tables, nothing else

No cover elements repeat. Each page carries only the logo, the title, the day blocks, and the footer.

Day blocks are ordered by date. Within a day, one row per person per shift.

| Column | Contents |
|---|---|
| ARBETARE | Worker name |
| PASS TIMMAR | That person's confirmed hours |
| PASS TIDER | Start–end times of the shift |
| VAD VI GJORDE | What was done that day |

Two columns are renamed from DocMaker: **Pass Typ → Pass Tider**, and the per-row **Project → Vad Vi Gjorde**. Everything else about the template stays.

### Footer — identical on every page, hardcoded

```
Postadress Adress:            Telefon: 073-398 78 68      Bankgiro: 443-4551
Söderto 3276, 242 93 Hörby                                Godkänd för F-skatt
                                                          Org.nr: 556788-2369
                                                          Momsreg.nr: CEFFSTA99339001
```

### Generation is a date range, not a whole project

A project runs open-ended and the admin logs it in slices, not once at the end.

**Admin opens a project → Generera Arbetsdagbok → picks a start date and an end date.** The document covers only that range. Without this, every export would reprint every shift the project has ever had.

Ordinarie tid on the cover sums only the shifts inside the chosen range.

**Generated ranges are remembered.** If the chosen range overlaps one already documented, the admin is warned before proceeding:

> Du har redan gjort en arbetsdagbok som dokumenterar [datum]. Vill du gå vidare?

A warning, not a block — re-issuing a document is legitimate. But it must never happen unknowingly.

### Bristsurvey — the admin's gap-filling path

The admin cannot confirm days. Only the assigned arbetsledare can. That is the pressure the whole system runs on, and removing it would let the owner rubber-stamp days he was not present for.

But the leader can quit, go silent, or simply never get to it, and the document is a legal obligation that cannot wait.

So: **when the admin picks a date range and something is missing, he gets a survey of exactly what is missing before generation.**

The survey lists every gap:

- Days with unconfirmed shifts — showing what the system **registered**: clock-in, clock-out, planned hours. Not confirmed figures, because there are none.
- Days with no "Vad Vi Gjorde" text.
- Any missing project or beställare field.

The admin fills them in. For the day descriptions this means ringing round and asking the workers what they did — deliberately laborious, because it should be the leader's job.

Completing the survey unblocks generation. It is not a bypass of the no-empty-cells rule; it is the manual way of satisfying it.

**A surveyed day is a confirmed day.** It leaves the arbetsledare's queue and never comes back. The admin has taken the shot — if the reconstructed figures are wrong, that is on him, and asking the leader to re-confirm a day already printed into a legal document would be worse than pointless.

**Provenance is recorded.** A day completed through the survey is marked as such, with who completed it. A leader confirming from site and an owner reconstructing from phone calls are different claims about the same hours, and the record must be able to tell them apart.

### The hard generation rule

**A document cannot be produced with any cell empty.** This is stricter than "all shifts confirmed". Generation is blocked unless *all* of the following exist:

- Every shift in range is confirmed
- Every day in range has a "Vad Vi Gjorde" description
- The project has a name
- The beställare has an address, a bolag, and an org nummer

**Consequence: project creation is a gate, not a form.** Every field the document needs must be captured and validated at creation time. Discovering a blank org nummer months later — when every shift is confirmed and final — is not recoverable.

---

## 2. Roles

Three roles. The split is by *authority*, not by seniority.

### Admin — the owner

The only role that can:

- Create projects
- Assign arbetsledare to a project
- Create Snabb Pass
- Generate the Arbetsdagbok
- Create accounts and workers
- Change an account's role
- Delete accounts
- **Delete shifts**

Can also do everything an arbetsledare can, **except confirm days**. Confirmation belongs to the leader who was on site. When days are missing, the admin fills the gaps through the bristsurvey (Section 1) rather than confirming directly.

### Arbetsledare — the supervisor

- Creates shifts (same as admin)
- Views the shift calendar
- **Confirms days** — the mechanism the whole system depends on

An arbetsledare confirms only for **projects they are assigned to**. Assignment happens when the admin creates the project. A project may have several.

Cannot: create projects, create Snabb Pass, delete shifts, touch accounts, or generate the document.

**An arbetsledare is also a worker.** Confirming is not a full-time job. They hold shifts like anyone else, and the admin decides which — necessarily on the projects they are assigned to, since a leader is not put on a project they do not run.

**An arbetsledare on no project** keeps access to every subpage but sees nothing in them. No days to confirm, no shifts to view. They cannot create shifts either — the project dropdown in Skapa Pass is mandatory and lists only the projects they are assigned to, so for them it is empty. Functionally they are a worker until the admin puts them on something. No special handling is needed; the scoping produces this on its own.

### Arbetare — the worker

Two things only:

- Paint days on their calendar they can work
- Accept or deny offered shifts, for days they are not already working

Plus clocking in and out, and seeing their own confirmed hours.

---

## 2b. The shift calendar

A single calendar showing every project's shifts.

- Each project has a colour.
- A shift repeating across consecutive days renders as one continuous bar spanning those days, not as separate marks.
- Tapping a day opens everything scheduled that day, across all projects.
- **Only admin can delete a shift**, and this is where it happens.

- **An ongoing shift cannot be deleted.** Once it has started, it is a fact that has to be confirmed, not erased.
- **Assigned workers are notified** when a shift they hold is deleted. The change is live — the shift disappears from their view immediately.
- **A deleted shift is never re-offered to the people removed from it.** It does not reappear in their Acceptera Pass queue; they were taken off for a reason. If the admin changes their mind, a Snabb Pass puts them back.

Visible to admin and arbetsledare. Not to arbetare — they see their own shifts, not the company's schedule.

### Kommande pass — the leader's day list

A subpage listing upcoming shifts, grouped by day. A leader running several projects gets a project filter to narrow it to one at a time.

This is the forward-looking counterpart to the confirmation queue: what is coming, rather than what has finished and needs an account of itself.

## 3. Entities

**Project**
Captured at creation, all required:
- Project name
- **Project address** — where the worker physically goes
- **Beställare address** — the customer's address, printed on the document
- Beställare bolag
- Beställare org nummer
- Services performed
- Start date
- **One or more assigned arbetsledare** — these and only these can confirm days for this project

No end date — that is the leader's call, made by declaring the work finished, not by a field set in advance. Soft-deletable. Auto-deactivates after a period with no shifts.

**Worker**
Soft-deletable. Sensitive: a worker must never see a colleague's personal data.

Required at creation: **name** and **email**. The email need not be verified or even real — it is the login identifier.

Optional, fillable by the worker later in their own profile: phone, personnummer, bank number, clearing number, profile picture.

There is no fastanställd flag. It was considered and removed — the owner sets the shifts and makes sure people get work, so an automatic always-include rule added complexity across the tiers, the exclusion filter and the availability logic without earning it.

**Creating a worker creates their account.** There is no separate account-creation flow and no waiting for the worker to sign themselves up. The sequence is fixed:

1. Admin fills the form. Name and email required.
2. Admin presses **Kopiera Inloggning**. This generates a six-digit password and copies a credential block to the clipboard:

```
Länk: <the app's current homepage URL>
Namn: <name field>
Email: <email field>
Lösenord: <generated>
```

3. Only now does **Tillverka Arbetare** become pressable. It glows once the credentials have been copied.

**Password rules:** minimum 6 characters, maximum 20, and every character must be typeable on both a phone keyboard and a desktop one without hunting through symbol panels.

**Recovery is the admin's job.** If the credentials are lost before they reach the worker, the admin regenerates them and copies again. There is no self-service reset — the email on an account is an identifier, not a guaranteed inbox.
4. Pressing it creates the worker and the account together.

The copy step gates the create step deliberately: an account whose credentials nobody holds is an account nobody can use, and the worker has no way to request them.

The admin then hands the block over however they like — message, paper, in person. The worker logs in and completes their own profile.

**From inside Snabb Pass.** If the person isn't on the roster yet, the worker dropdown offers **Ny Arbetare**. The same form appears, the same copy-then-create sequence runs, and the admin returns to the shift detail screen and finishes as though nothing happened.

**Account**
A login. Carries the role.

The relationship is one-directional:

- **Every worker has an account.** There is no path that creates one without the other — worker creation *is* account creation, including from inside Snabb Pass. `worker.account_id` is not nullable.
- **Not every account has a worker.** Office staff — admin, and arbetsledare who never work shifts themselves — hold accounts with no worker record. `account.worker_id` is nullable.

So an account-less worker cannot exist, and no policy needs to handle one.

**Pass (the shift)**
Project, date, start time, end time, planned hours, headcount. A pass is a *demand for people*, not a person's work. One pass with headcount 3 is one row, not three.

**Tilldelning (the assignment)**
One worker's place on one pass. Carries: how they got there (handplockad / förval / öppen / manuell / snabb), clock-in, clock-out, the untouched originals of both, who edited them and when, a lateness mark, and that person's own confirmed hours.

This split is the load-bearing decision. Without it, "this shift needs three people and one slot is open" cannot be expressed at all.

**Dagsbeskrivning (the "Vad Vi Gjorde" text)**
One record per project per date. Written by the leader at confirmation. Mandatory before that day can be confirmed. Prints on every row of that day's table.

**Förval (availability)**
Worker plus date, marked can-work or can't-work. Not tied to a project or a shift. Writes nothing anywhere until a leader creates a shift on that day.

**Papperskorgen (trash)**
Soft delete with a retention window, then a purge. A project or worker in the bin makes its shifts and assignments count nowhere — not in totals, not in the calendar, not in the Arbetsdagbok. Restoring brings the hours back.

---

## 4. The lifecycle, start to finish

**Step 1 — Arbetare marks förval**
Drag across a calendar, mark days can-work or can't-work. This is an entry into that day's queue and nothing more.

**Step 2 — Arbetsledare creates demand**
Homepage → Skapa Pass → full-screen calendar → finger-drag to select days (dragging over a selected day unselects it) → confirm with a control fixed in the corner → detail screen.

The detail screen holds one or more template rows:

```
(+) 3 (-)   07:00 – 16:00   9h
(+) 1 (-)   07:00 – 15:00   8h
```

Every row applies to every selected day. Two rows across twelve days generates twenty-four passes. Hours are typed by hand — never derived from the span, because unpaid lunch means the span is longer than the hours worked and that is the normal case.

The leader may **hand-pick** workers during creation. This does not assign them. It marks them as top-ranked *for this batch*.

**Step 3 — Exclusion filter, before anything else**
A worker who already holds an assignment on that date is invisible for that date. Not rankable, not offered, not a fallback — even if hand-picked. Nobody is ever on two projects the same day; the address and the directives have to be unambiguous.

**Step 4 — The priority list, walked top to bottom**

*Tier 1 — Handplockade med förval.* Hand-picked by the leader **and** they pre-picked that day. Being hand-picked is a ranking modifier, not a grant — the förval is the entry ticket.

A hand-picked worker who did not pre-pick a day is not a mistake to warn about. Not marking a day means they cannot work it. They still reach Acceptera Pass later if they are free, but nothing is wrong and the leader needs no notice.

*Tier 2 — Övriga förvalda.* Everyone else who pre-picked that day. Ordered by: fewest shifts held that week ranks highest. A shift counts whether or not it has been confirmed. Each lateness mark pushes a worker one position down, cumulatively and permanently. Ties break randomly.

**Shortfall warning at creation.** If a batch's total slots exceed the workers who have pre-picked those days, the leader is told before generating. Anything short of coverage is worth knowing about while the schedule can still be changed.

*Tier 3 — Acceptera Pass.* Reached only when the förval list is exhausted or empty. Offered as an accept/decline card to every remaining worker with no assignment that day — **except anyone who marked that day can't-work.** Marking a day means you cannot work it, so offering it asks a question that has already been answered. Card shows date, project, address, times, hours. First accepted wins; the slot closes instantly and the pass vanishes from everyone else's queue once headcount is met. Two workers racing for the last slot resolve to exactly one winner, decided randomly, enforced in the database.

**Step 5 — Dropouts**
More than five days out: the slot reopens and refills down the list normally. Inside five days: no auto-fill. Manual assignment or a Snabb Pass. Nobody is ready for a last-minute change and the system should not pretend otherwise.

**Step 5b — Removing a worker from a pass**

The leader taps the day in the calendar, sees everyone working it, and taps a trash icon beside a name. That worker is off that day.

There is no "move" feature and nothing splits automatically. If that person is needed on another day, the leader creates a separate shift for that day — one day, one slot, one person, who takes it directly — or uses a Snabb Pass.

**The vacated slot reopens. Headcount does not drop.** The pass still needs the same number of people, so the empty slot cascades back down the list:

1. Offered to anyone who pre-picked that day and holds no shift that day.
2. If nobody there, Acceptera Pass goes out to everyone free that day who did not pre-pick it.
3. If still nobody takes it, the day runs short-staffed. An unfilled slot is never an error — it is a day that ran with fewer people, and it confirms exactly like any other.

Within five days of the shift, steps 1 and 2 do not fire automatically; the leader places someone manually or creates a Snabb Pass.

**Step 6 — The day happens**
Workers clock themselves in and out. The timestamp is the server's, never the phone's — a phone running ten minutes fast writes ten minutes of error into evidence of hours worked and nobody would notice.

A pass that is scheduled but not started, and one that is in progress, are told apart by whether a clock-in exists, not by a separate state.

**Step 7 — Snabb Pass, the escape hatch**
**Admin only.** Bypasses the entire priority list. Requires only a name. For last-second dropouts, verbal arrangements, covering a no-show. **On paper it is an ordinary shift** — it prints in the Arbetsdagbok exactly like any other row. Only the way it enters the system differs. It still enters the confirmation queue; Snabb Pass skips the picking, never the confirming. If that person held an assignment elsewhere that day, the Snabb Pass wins and the earlier one is released.

**Step 8 — Confirmation**

This is the mechanism everything else exists to feed. Without it there is no Arbetsdagbok — the admin cannot generate a document covering any window the arbetsledare has not confirmed.

**Trigger.** A day becomes confirmable the minute its last shift has ended. Not at midnight, not the next morning — when the final shift on that day is over by the clock.

**Who.** The arbetsledare assigned to that project. Assignment is set by the admin at project creation, and a project may have several. An arbetsledare sees only the days belonging to projects they are on.

**The list.** Days, oldest first, each headed by its date and weekday:

```
AUG 16 MÅNDAG
[Arbetare]   [start]   [slut]   [timmar]
```

Every field on the row is editable. Start time, end time, hours worked — the leader corrects whatever is wrong.

**One row, one late mark.** If any of the three fields is edited, the row is logged late — once. Editing all three is still one mark. Three corrections to one person's shift is one deviation, not three, and the priority-list demotion moves them one position, not three.

**Before a day can be confirmed**, the leader writes a few words about what that day's workers did. This is the "Vad Vi Gjorde" text, mandatory, one per project per day, and it prints on every row of that day's table in the document.

**Confirmation is final.** No edits after.

**Removing someone who wasn't there.** If a person on the list did not actually work that shift, the leader removes them from the day here. That is different from deleting a shift — it corrects the record of who was present.

**Everything on this screen exists for the document.** The time edits, the hours edits, the removals, the "Vad Vi Gjorde" text — none of it is bookkeeping for its own sake. Each one lands in a cell of the Arbetsdagbok. That is why confirmation is final and why nothing generates until it is done.

A day can be confirmed understaffed. The day passed; that is a fact worth recording.

If unconfirmed days exist, a full-screen popup appears on app open, oldest first. Its dismiss control fades in after one second.

**Step 9 — Arbetsdagboken**
The leader sets the date range — projects have no fixed end date, so the range must be theirs to set. Generation is blocked per Section 1's rule. The admin exports the PDF.

That block is the entire enforcement mechanism. The admin needs the document; only the leader can unblock it. The chasing happens in real life, outside the app.

---

## 5. Invariants — non-negotiable

1. **Hours are typed by a human.** Nothing derives them. Not from clock stamps, not from the span. Unpaid lunch makes span ≠ hours the normal case.
2. **No worker holds two assignments on the same date.** Ever.
3. **Clock stamps are append-only evidence.** The leader may overwrite the working value; the original survives, visible and attributed.
4. **Only a leader writes hours or confirmation state.** Enforced in the database, not the interface.
4b. **An arbetsledare confirms only for projects they are assigned to.** This is a per-row scope, not a role check — the database must enforce it row by row.
5. **Confirmation is final.**
6. **The Arbetsdagbok cannot generate with any cell empty** — not shifts, not the "Vad Vi Gjorde" text, not the beställare fields.
7. **Every field the document needs is captured and validated at project creation.**
8. **Deleted projects and workers make their shifts count nowhere** — every read, no exceptions.
9. **Dates are Stockholm-anchored.** Month windows half-open. A shift must never file under the wrong month because UTC midnight hasn't arrived yet.
10. **Confirmed hours are the only hours shown to a worker.** A number that shrinks when someone corrects it is worse than no number.
11. **The last active leader cannot be removed, demoted, or paused.** Otherwise nobody can promote anyone back and the system needs direct database access to recover.

---

## 6. Architectural constraints that shape everything

**No server.** The application is a static export. The browser holds the auth token and talks to the database directly. Every restriction that lives in the interface is decorative — the database is the only real boundary. This is why:
- Role separation must be enforced in database policies and triggers, not in the client.
- Column-level grants cannot separate roles: every logged-in user is the same database role, so a grant restricting workers restricts leaders identically. Triggers comparing old and new values are the mechanism that works.
- Notifications, reminders, scheduled alerts and deadline emails are **impossible as-is**. They need something running — a scheduled function or a small server. That is an architecture decision, not a feature.

**Notifications are in-app only.** A red dot and a message on next load. No push, no email, no scheduled digests — those need a server or a scheduled function, and neither exists. In-app is enough for the two things that actually need to travel: a deleted shift, and an offered one.

**Account creation needs elevated credentials**, so it runs through a separate function with its own deployment path. Creating an auth user requires the service-role key, which cannot ship in a static bundle.

**Role is read from the database, not the token.** A role change takes effect on next load rather than persisting stale for the token's lifetime.

**Aggregation currently happens in the browser.** Every hours total transfers matching rows to the client. Fine at this scale; worth knowing it is O(all shifts) per page view.

---

## 7. Screens

**Admin**
Everything below, plus: Skapa Projekt · Snabb Pass · Arbetsdagbok · Konton & Roller · shift deletion from the shift calendar

**Arbetsledare**
Hem · Skapa Pass · Bekräfta Pass · Skiftkalender · Kommande Pass · Alla Projekt · Alla Arbetare · own shifts and clocking, same as any worker

**Arbetare**
Hem (own shifts, own confirmed hours this month, clock control) · Min kalender (förval) · Acceptera Pass · Min profil

## 8. Decisions — all settled

Nothing here is open. Anything discovered later that is not covered is a stop-and-ask, never a guess.

**Roles and scope**
- Three roles: admin, arbetsledare, arbetare. Admin holds real exclusive powers, not extra buttons.
- Confirmation is scoped per project. Only assigned arbetsledare can confirm a project's days.
- An arbetsledare is also a worker and holds shifts.
- Snabb Pass is **admin only**. Section 2 and Step 7 once disagreed; Section 2
  was right. Creating one is inseparable from adding people off-roster, and
  that is an account-creation power the arbetsledare does not have.
- The project dropdown is mandatory in Skapa Pass and lists only assigned projects. This makes an unassigned leader harmless without special handling.

**Assignment**
- Fastanställd: removed entirely.
- Hand-picked is a ranking modifier on förval, never a grant. No warning when a pick has not marked a day — not marking it means they cannot work it.
- Tier 1 is ordered the same way as Tier 2: fewest shifts that week first, each lateness mark pushing one position down, ties random.
- Acceptera Pass skips anyone who marked the day can't-work. An explicit no is not asked again.
- A shortfall between total slots and pre-pickers is flagged to the leader at creation.
- Removing a worker reopens the slot; headcount never drops.
- A deleted shift is never re-offered to the people removed from it. Snabb Pass is the way back.

**Identity**
- Every worker has an account; not every account has a worker.
- Snabb Pass creates a real worker and a real account through the same form.
- Passwords: 6 to 20 characters, keyboard-accessible on phone and desktop.
- Recovery is the admin regenerating and re-copying. No self-service reset.

**Confirmation and the document**
- The admin cannot confirm days. Missing days are filled through the bristsurvey, prefilled from registered data, with provenance recorded.
- A surveyed day is confirmed and leaves the leader's queue permanently.
- The beställare fields have no toggles. Always printed, no exceptions.
- The document header repeats on every page: logo and title only.
- One row, one late mark, however many fields were edited.
- Ongoing shifts cannot be deleted. Workers are notified when a future one is.
- Beställare fields always print. No per-document toggles.
- Footer is hardcoded Bella Service, identical on every page.
- Generation is a date range per export, and generated ranges are remembered and warned about on overlap.

**Platform and design**
- Mobile first. Every screen designed for a phone, then adapted upward.
- Black and white until everything works. No styling before function.
- The calendar is the one exception — drag-to-paint needs a real layout from the start.
- Built so a child could use it: large targets, obvious affordances, minimal per screen.
- Notifications are in-app only.
- Payload fields renamed on port: `hours`, `passTider`, `vadViGjorde`.

## 8b. The DocMaker template port

Source lives at `docs/docmaker-template/`. It is a single string-template module, ~8KB, no framework.

**Take verbatim:**

- **The print CSS.** `@page { size: A4; margin: 0 }` with the body doing the insetting via `padding: 20mm 18mm 30mm 18mm`. The 30mm bottom reserves the footer band. Page-margin CSS applies only to the first and last sheet, which is why the body carries it instead. This was solved the hard way once already.
- **`parseHours` and `sumOrdinarieTid`.** Fifteen lines, pure. Swedish decimal comma in and out. Rewriting them is how you get silently wrong totals.
- **The day table as CSS Grid**, `1.1fr 1fr 1.3fr 1.6fr`. Not a `<table>`.
- **`page-break-inside: avoid`** on day blocks, `page-break-after: always` on the cover.
- **Footer as `position: fixed; bottom: 14mm`**, which repeats per page in Chromium's print engine.
- **The logo base64-inlined**, not linked. A path-linked image fails silently in a print render.

**Change on port:**

- **Drop the `adressChecked` / `bolagChecked` / `orgnrChecked` conditionals.** All three beställare fields always print.
- **Rename the payload fields.** `passTyp1` → `hours`, `passTyp2` → `passTider`, `project` → `vadViGjorde`. The old names exist only to keep DocMaker's saved drafts importable, and there are none to keep.
- **`formatTimestamp` must be Stockholm-anchored**, not machine-local. Invariant 9.
- **`loadCompany()` reads from disk.** In a static export the footer values ship as a module or a constant.

**The header repeats on every page**, like the footer. Logo and the word "Arbetsdagbok", nothing else. The current template renders it once after the cover, so pages 3 onward lose it — that is a bug to fix in the port, not behaviour to keep.

**Brand palette**, from the app chrome: navy `#1f2b40`, gold `#e0a83a`. Document colours: text `#1a1a1a`, headings `#111`, header row `#FBEFD8`, zebra `#FDF9F1`, header text `#303c54`, footer `#767676`, footer rule `#cfcfcf`. Display font Georgia; document font Segoe UI / Arial, 10.5pt base.

---

## 9. What the rebuild must not lose

Carry these forward. They were each learned the hard way:

- The two-hours model: a planned figure on the pass, a confirmed figure per person. A shared column makes both the zero-hour no-show confirm and the per-worker Arbetsdagbok row impossible.
- Server-side timestamps for clocking.
- The distinction between null hours (not confirmed) and zero hours (confirmed no-show). Conflating them puts a false claim in a legal document.
- The audit trail on clock edits, with the editor's identity.
- The last-leader lockout guard.
- Stockholm-anchored date handling.
- The soft clocking window — today and yesterday visible, nothing forbidden at the database level. A hard same-day rule breaks night shifts and breaks catch-up after poor signal.

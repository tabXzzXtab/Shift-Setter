# Shift System — Ground-Up Inventory

Everything known about this system, stated without reference to any existing code, table, or migration. This is the seed document for a clean rebuild.

---

## 0. What this business actually does

A Swedish construction and service company. Work happens at **projects** — physical sites with addresses, running for open-ended durations with no fixed end date. **Workers** are sent to those sites for **shifts**. The company is legally required to hold a record of hours worked. That record is the **Arbetsdagbok**, and producing it correctly is the reason the entire system exists.

Everything downstream of that: the scheduling, the clocking, the confirmations, the priority lists — all of it exists to make one document accurate and defensible.

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
| GJORDE | What was done that day |

Two columns are renamed from DocMaker: **Pass Typ → Pass Tider**, and the per-row **Project → Gjorde**. Everything else about the template stays.

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

### The hard generation rule

**A document cannot be produced with any cell empty.** This is stricter than "all shifts confirmed". Generation is blocked unless *all* of the following exist:

- Every shift in range is confirmed
- Every day in range has a Gjorde description
- The project has a name
- The beställare has an address, a bolag, and an org nummer

**Consequence: project creation is a gate, not a form.** Every field the document needs must be captured and validated at creation time. Discovering a blank org nummer months later — when every shift is confirmed and final — is not recoverable.

---

## 2. Roles

Three roles. Each sees a different application.

**Admin** — the owner / office. Creates projects. Extracts the Arbetsdagbok and cannot get it until leaders have confirmed. Can do everything an arbetsledare can, plus Snabb Pass. Not a scheduler by nature; a consumer of the record.

**Arbetsledare** — the supervisor. Runs one or several sites. Creates shifts, decides who works, confirms what actually happened, sets the Arbetsdagbok's date range. The only role that can write hours. The bottleneck by design.

**Arbetare** — the worker. Two surfaces only: a calendar where they mark days they can work, and a queue of offered shifts to accept or decline. Plus a summary of their own hours, shifts, and lateness. They clock themselves in and out. They never set their own pay.

---

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
4. Pressing it creates the worker and the account together.

The copy step gates the create step deliberately: an account whose credentials nobody holds is an account nobody can use, and the worker has no way to request them.

The admin then hands the block over however they like — message, paper, in person. The worker logs in and completes their own profile.

**From inside Snabb Pass.** If the person isn't on the roster yet, the worker dropdown offers **Ny Arbetare**. The same form appears, the same copy-then-create sequence runs, and the admin returns to the shift detail screen and finishes as though nothing happened.

**Account**
A login. Links to a worker (or to nobody, for office staff). Carries the role. An account and a worker are separate things — office staff have accounts with no worker; a worker can exist on the roster with no login at all.

**Pass (the shift)**
Project, date, start time, end time, planned hours, headcount. A pass is a *demand for people*, not a person's work. One pass with headcount 3 is one row, not three.

**Tilldelning (the assignment)**
One worker's place on one pass. Carries: how they got there (handplockad / förval / öppen / manuell / snabb), clock-in, clock-out, the untouched originals of both, who edited them and when, a lateness mark, and that person's own confirmed hours.

This split is the load-bearing decision. Without it, "this shift needs three people and one slot is open" cannot be expressed at all.

**Dagsbeskrivning (the Gjorde text)**
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

*Tier 1 — Handplockade med förval.* Hand-picked by the leader **and** they pre-picked that day. Being hand-picked is a ranking modifier, not a grant — the förval is the entry ticket. A hand-picked worker who never marked that day is simply not on the list. Losing rank here is not losing work; there are many projects.

*Tier 2 — Övriga förvalda.* Everyone else who pre-picked that day. Ordered by: fewest shifts held that week ranks highest. A shift counts whether or not it has been confirmed. Each lateness mark pushes a worker one position down, cumulatively and permanently. Ties break randomly.

*Tier 3 — Acceptera Pass.* Reached only when the förval list is exhausted or empty. Offered as an accept/decline card to every remaining worker with no assignment that day. Card shows date, project, address, times, hours. First accepted wins; the slot closes instantly and the pass vanishes from everyone else's queue once headcount is met. Two workers racing for the last slot resolve to exactly one winner, decided randomly, enforced in the database.

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
Arbetsledare and admin only. Bypasses the entire priority list. Requires only a name. For last-second dropouts, verbal arrangements, covering a no-show. **On paper it is an ordinary shift** — it prints in the Arbetsdagbok exactly like any other row. Only the way it enters the system differs. It still enters the confirmation queue; Snabb Pass skips the picking, never the confirming. If that person held an assignment elsewhere that day, the Snabb Pass wins and the earlier one is released.

**Step 8 — Confirmation**
A day becomes confirmable only once **every** shift on it has passed its end time. The leader then confirms or denies every shift that happened that day, as one act.

- Sorted oldest day first, so the leader never scrolls to find what's overdue.
- Split by **day + project**, never merged across projects — one leader may run several sites and each needs its own account of what happened.
- Each row is one worker's one shift: name, project, ± on start time, ± on end time, a lateness checkbox, an X for no-show, per-row confirm.
- Untouched rows log exactly as designated. Only edited rows carry a deviation.
- Clock stamps are evidence. The leader sets the figure that counts. Adjusting a stamp preserves the original underneath, visible, attributed to whoever changed it.
- A **mandatory Gjorde description per day + project** must be filled before that day's confirm becomes pressable. This text is what prints in the document's GJORDE column.
- Confirmation is **final**. No edits after.
- A lateness mark demotes that worker one position on the priority list, permanently.
- A day can be confirmed understaffed. The day passed; that's a fact worth recording.

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
5. **Confirmation is final.**
6. **The Arbetsdagbok cannot generate with any cell empty** — not shifts, not the Gjorde text, not the beställare fields.
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

**Account creation needs elevated credentials**, so it runs through a separate function with its own deployment path.

**Role is read from the database, not the token.** A role change takes effect on next load rather than persisting stale for the token's lifetime.

**Aggregation currently happens in the browser.** Every hours total transfers matching rows to the client. Fine at this scale; worth knowing it is O(all shifts) per page view.

---

## 7. Screens

**Leader**
Hem · Skapa Pass · Snabb Pass · Bekräfta Pass · Logga Timmar · Kalender · Alla Projekt · Alla Arbetare · Arbetsdagbok · Papperskorgen · Inställningar (konto & roller)

**Arbetare**
Hem (own shifts, own confirmed hours this month, clock control) · Min kalender (förval) · Acceptera Pass

**Admin**
Everything the leader has, plus project creation, account and role management, and Arbetsdagbok export.

---

## 8. Open questions — must be answered, not guessed

1. **Hand-picked without förval.** They get nothing under this design — the förval is the entry ticket. Should the leader be warned at creation time that some of their picks haven't marked those days available?
2. **Tier 2 exhaustion across a long batch.** Twelve days at three slots with only four pre-pickers means Acceptera Pass fires on nearly every day. Intended, or flagged to the leader at creation?
3. **Admin as a real third role.** Every policy currently asks one binary question. A third role means revisiting all of them plus the column guard. Build now, or run on two roles and add later?
4. **Notifications.** Requires infrastructure that does not exist — a scheduled function at minimum. In scope at all, or does the app stay silent?
5. **Tracking generated ranges.** A project produces many Arbetsdagböcker over its life, each covering a date range the admin picks by hand. Does the system remember which ranges are already documented, so it can warn on an overlap or a gap? Without it, a week can be logged twice or missed entirely and nothing in the app would show it.
6. **Password recovery.** The six-digit login is generated once and copied to the clipboard. If it is lost before it reaches the worker, what is the recovery path — admin regenerates, or standard email reset (which assumes a real inbox the worker can reach)?

### Settled

- **Fastanställd: removed entirely.** Not a flag, not a tier, not a rule. The owner sets shifts and ensures people get work.
- **Vakans on removal: the slot reopens.** See Section 4, Step 5b.
- **Beställare fields always print.** No per-document toggles.
- **Footer is hardcoded** Bella Service, identical on every page.
- **Generation is a date range**, chosen by the admin per export.
- **Snabb Pass creates a real worker and a real account**, via the same Ny Arbetare form as any other worker. Never free text.

## 9. What the rebuild must not lose

Carry these forward. They were each learned the hard way:

- The two-hours model: a planned figure on the pass, a confirmed figure per person. A shared column makes both the zero-hour no-show confirm and the per-worker Arbetsdagbok row impossible.
- Server-side timestamps for clocking.
- The distinction between null hours (not confirmed) and zero hours (confirmed no-show). Conflating them puts a false claim in a legal document.
- The audit trail on clock edits, with the editor's identity.
- The last-leader lockout guard.
- Stockholm-anchored date handling.
- The soft clocking window — today and yesterday visible, nothing forbidden at the database level. A hard same-day rule breaks night shifts and breaks catch-up after poor signal.

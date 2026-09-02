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

### Document structure

**Header:** logo, title "Arbetsdagbok", creation timestamp.

**Beställare block** (the customer commissioning the work):
- Address (street, postcode, city) — **not** the project address
- Bolag (company name)
- Org nummer

**Project line:** the project's name. Required.

**Ordinarie tid:** total confirmed hours across the range. There is no övertid concept.

**Day blocks**, one per date, each carrying a table:

| Column | Contents |
|---|---|
| ARBETARE | Worker name |
| PASS TIMMAR | That person's confirmed hours |
| PASS TIDER | Start–end times of the shift |
| GJORDE | What was done that day |

**Footer:** postadress, telefon, bankgiro, F-skatt status, org.nr, momsreg.nr.

**Approval block:** "GODKÄND AV", ort & datum, signature line.

### Column notes

- **Pass Tider** replaces DocMaker's "Pass Typ". It is the shift's start and end times.
- **Gjorde** replaces DocMaker's per-row "Project" column. It holds the leader's description of the day's work, written once per day at confirmation and repeated down every row of that day's table.

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
Name, personnummer, bank details, contact. Soft-deletable. May carry a **fastanställd** flag. Sensitive: a worker must never see a colleague's personal data.

**Account**
A login. Links to a worker (or to nobody, for office staff). Carries the role. An account and a worker are separate things — office staff have accounts with no worker; a worker can exist on the roster with no login at all.

**Pass (the shift)**
Project, date, start time, end time, planned hours, headcount. A pass is a *demand for people*, not a person's work. One pass with headcount 3 is one row, not three.

**Tilldelning (the assignment)**
One worker's place on one pass. Carries: how they got there (fastanställd / förval / open pool / manual / snabb), clock-in, clock-out, the untouched originals of both, who edited them and when, a lateness mark, and that person's own confirmed hours.

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

*Fastanställd* sits outside the tiers. Needs work daily; the project doesn't matter. Auto-included on eligible shifts unless they marked that day can't-work — which is the only thing that overrides it.

**Step 5 — Dropouts**
More than five days out: the slot reopens and refills down the list normally. Inside five days: no auto-fill. Manual assignment or a Snabb Pass. Nobody is ready for a last-minute change and the system should not pretend otherwise.

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

1. **Hand-picked without förval.** Under this design they get nothing. Should the leader be warned at creation time that some of their picks haven't marked that day available? Silent non-inclusion is what produces a phone call.
2. **Fastanställd against a full Tier 1.** Three hand-picked pre-pickers fill a three-slot shift. A fastanställd who wasn't picked needs work that day. Tier 1 currently wins, which contradicts "fastanställd works daily." Which rule yields?
3. **Tier 2 exhaustion across a long batch.** Twelve days at three slots with four pre-pickers means Acceptera Pass fires on nearly every day. Intended, or flagged to the leader at creation?
4. **Moving one worker off a shared pass.** Date, project and times belong to the pass, so editing them moves everyone. If a single worker is to be split onto a new pass instead — does the original pass's headcount drop by one, or does the slot reopen and refill?
5. **Admin as a real third role.** Every policy currently asks one binary question. A third role means revisiting all of them plus the column guard.
6. **Notifications.** Requires infrastructure that does not exist. Decide whether it is in scope at all.
7. **The Beställare toggles.** DocMaker let the user switch address / bolag / org nummer off per document. Given the no-empty-cells rule, do these stay optional at generation time, or are all three always printed?
8. **The document footer.** Postadress, telefon, bankgiro, F-skatt, org.nr, momsreg.nr. Hardcode as Bella Service, or make it configurable for future companies?
9. **Snabb Pass identity.** A Snabb Pass needs only a name. Does that create a lightweight worker record on the roster, or is it free text on the assignment? The first makes them re-selectable later; the second keeps the roster clean.

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

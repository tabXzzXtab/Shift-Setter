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
| **Ordinarie tid: Xh** | Sum of all confirmed hours in the document's date range. A `leader_confirmed` day counts; the admin's stage 2 approval is not waited for. |
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

**The Arbetsdagbok lives inside the project.** It is not a landing-page item and it has no standalone page. The admin opens the project and generates from there. A document is always about exactly one project, so every other route asks him to pick the project twice.

**Admin opens a project → Generera Arbetsdagbok → picks a start date and an end date.** The document covers only that range. Without this, every export would reprint every shift the project has ever had.

Ordinarie tid on the cover sums only the shifts inside the chosen range.

**The PDF is a direct browser download. There is no print dialog.** The file is named:

```
[firstDate]-[lastDate]-[year]-[projektnamn].pdf
```

Dates are `DDMon` — day number and three-letter month, the month abbreviation capitalised. The project name is lowercased. A 19–22 August 2026 range on Landskrona produces:

```
19Aug-22Aug-2026-landskrona.pdf
```

The name carries one year, so a range crossing a year boundary is not covered by this pattern. If one arises, stop and ask.

**Generating consumes the days.** Every day in the range moves to **Bekräftelse Historik** when the document is produced, whatever stage it had reached. A day that was only `leader_confirmed` goes to Historik with the rest — it does not wait for the admin's approval to get there.

**Historik shows current values, not printed ones.** If the admin edits a day at stage 2 after the document was generated, Historik reflects the new figures. The PDF does not change — it is a snapshot of the moment it was produced. The two can disagree, and that is intended: regenerating the range is how a corrected document is obtained.

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

**Where a surveyed day lands.** The survey has no stage 1 behind it — there is no leader claim to review — so a surveyed day is written straight to `admin_confirmed` and never enters the admin's review queue. `confirmed_via` still records the route, which is the axis that tells a reconstruction from a confirmation apart.

**A flagged day narrows the survey to itself.** If the range contains a day awaiting the admin's flagged confirmation (Section 4, Step 5c) and he generates anyway, the survey opens for that day alone. Everything else in the range is already satisfied, so the survey is a targeted stop rather than a full sweep.

### The hard generation rule

**A document cannot be produced with any cell empty.** This is stricter than "all shifts confirmed". Generation is blocked unless *all* of the following exist:

- Every shift in range is confirmed — `leader_confirmed` is enough
- Every day in range has a "Vad Vi Gjorde" description
- The project has a name
- The beställare has an address, a bolag, and an org nummer

**Stage 2 is not a gate.** The document generates from `leader_confirmed` days. Making it wait for the admin's own approval would have the admin blocking himself, and the claim the document rests on is the leader's, not his. The one exception is a flagged day (Section 4, Step 5c): a day no leader was on has no stage 1 claim behind it at all, so it cannot print until the admin confirms it — through the bristsurvey, if he generates first.

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
- **Review and approve confirmed days** — stage 2 (Step 8)

Can also do everything an arbetsledare can, **except make a stage 1 confirmation**. That claim belongs to the leader who was on site, and reviewing a claim is not the same act as making one.

Three routes put a day into `admin_confirmed` without a leader having confirmed it:

- **Stage 2 approval** — a leader confirmed it and the admin signed off, with or without edits.
- **Bristsurvey** — the leader never confirmed and the admin reconstructed the day from registered data (Section 1).
- **A flagged day** — the day ran with a worker as ansvarig, or with nobody, so there was no leader to make the claim. Admin and only admin confirms it (Step 5c).

None of the three is the admin confirming a day a leader still could have. That distinction is the pressure the whole system runs on, and it survives the second stage intact.

### Arbetsledare — the supervisor

- Creates shifts (same as admin)
- Views the shift calendar
- **Confirms days — stage 1** — the mechanism the whole system depends on

An arbetsledare confirms only for **projects they are assigned to**. Assignment happens when the admin creates the project. A project may have several.

Cannot: create projects, create Snabb Pass, delete shifts, touch accounts, or generate the document.

**An arbetsledare is also a worker, and is placed automatically.** Confirming is not a full-time job. Any day a worker holds a slot on one of their projects, the leader is assigned to that day — no offer, no Acceptera Pass card, no admin action. Their people are on site, so they are on site. See Step 4b.

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
- **Tapping a day opens Öppna Dag** — everything scheduled that day, across all projects. Öppna Dag has no standalone page and no landing-page button; the calendar is the only way in. A day list reached without first picking a day would be a screen asking a question the calendar has already answered.
- **Only admin can delete a shift**, and this is where it happens.

- **An ongoing shift cannot be deleted.** Once it has started, it is a fact that has to be confirmed, not erased.
- **Assigned workers are notified** when a shift they hold is deleted. The change is live — the shift disappears from their view immediately.
- **A deleted shift is never re-offered to the people removed from it.** It does not reappear in their Acceptera Pass queue; they were taken off for a reason. If the admin changes their mind, a Snabb Pass puts them back.

Visible to admin and arbetsledare. Not to arbetare — they see their own shifts, not the company's schedule.

### Tapping a person in Öppna Dag

**A worker** shows **Avboka Pass** — the trash icon beside the name is the same act. It takes them off that day (Step 5b).

**An arbetsledare** shows two buttons instead:

- **Byta Plats Med Arbetsledare** — swap this day with another arbetsledare.
- **Avboka Pass** — take them off the day. This opens the replacement popup in Step 5c.

A leader gets buttons where a worker gets a trash icon because a leader is never simply absent. Somebody has to be answerable for the day, and the choice of who cannot be skipped.

### Kommande pass — the leader's day list

A subpage listing upcoming shifts, grouped by day. A leader running several projects gets a project filter to narrow it to one at a time.

This is the forward-looking counterpart to the confirmation queue: what is coming, rather than what has finished and needs an account of itself.

Reached from the leader's hamburger menu as **Mina Pass** (Section 7). Whether Mina Pass is this list under a new name or a second list beside it is not settled.

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
One worker's place on one pass. Carries: how they got there (handplockad / förval / öppen / manuell / snabb / **ledare**), clock-in, clock-out, the untouched originals of both, who edited them and when, a lateness mark, and that person's own confirmed hours.

`ledare` is the auto-assignment of Step 4b. It is not a slot the pass was demanding — the leader's row exists because workers are there, so it never consumes headcount and never competes with anyone on the priority list.

This split is the load-bearing decision. Without it, "this shift needs three people and one slot is open" cannot be expressed at all.

**Dagsbeskrivning (the day record — "Vad Vi Gjorde" plus confirmation state)**
One record per project per date. The text is written by the leader at confirmation, is mandatory before that day can be confirmed, and prints on every row of that day's table.

The same record carries the day's confirmation stage. **Two statuses, not one:**

| Status | Meaning |
|---|---|
| `leader_confirmed` | The arbetsledare has confirmed the day. Enough to generate the Arbetsdagbok. |
| `admin_confirmed` | The admin has reviewed and approved it. Terminal. |

The stage is a separate axis from `confirmed_via`, which records the *route* — leader, bristsurvey, a worker as ansvarig, nobody. Route and stage answer different questions, and neither can be read off the other.

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

**Step 4b — The arbetsledare is placed automatically**

The priority list is for workers. A leader does not queue for their own project.

**Any day a worker holds a slot on a project, that project's arbetsledare is assigned to that day.** Automatically, the moment the assignment exists. No offer, no accept, no deny — this replaces Acceptera Pass for leaders entirely. **If a project has two arbetsledare, both are assigned.**

**Their times are the workers' envelope.** Earliest shift start to latest shift end, across every worker on that project that day. A leader who arrives before the first person and leaves after the last is the ordinary case, and that span is what the row shows.

**Their hours are prefilled from that span and stay editable.** The prefilled number is a starting point the leader overwrites before confirming — lunch comes off it like anyone else's. This does not weaken invariant 1: a number a human must accept or correct is not a derived number. Nothing writes a leader's hours that no human looked at.

**They clock themselves in and out**, same as any worker, same server timestamps.

**They print as a row in the Arbetsdagbok**, same as any worker. The document does not mark a leader's row as different. The customer is buying hours on their site, and a leader's hours are hours on their site.

**Two projects on one day is allowed — for an arbetsledare only.** Invariant 2 forbids a *worker* holding two assignments on a date. A leader running two projects that both have people on Tuesday is assigned to both, and prints a row in each project's Arbetsdagbok, with times computed per project from that project's workers. This is the single exception to invariant 2, nothing but auto-assignment creates it, and it does not extend to arbetare.

**Step 5 — Dropouts**
More than five days out: the slot reopens and refills down the list normally. Inside five days: no auto-fill. Manual assignment or a Snabb Pass. Nobody is ready for a last-minute change and the system should not pretend otherwise.

**Step 5b — Removing a worker from a pass**

The leader taps the day in the calendar, opens Öppna Dag, sees everyone working it, and takes someone off with **Avboka Pass** — the trash icon beside the name. That worker is off that day.

There is no "move" feature and nothing splits automatically. If that person is needed on another day, the leader creates a separate shift for that day — one day, one slot, one person, who takes it directly — or uses a Snabb Pass.

**The vacated slot reopens. Headcount does not drop.** The pass still needs the same number of people, so the empty slot cascades back down the list, and the cascade starts the moment the worker comes off:

1. **If anyone who marked förval for that day is free**, a popup opens — headed **Välj Utbyte**, listing every available pre-picker not already working that day. Picking one fills the slot on the spot.
2. **If nobody is free, there is no popup.** The slot goes straight out as Acceptera Pass cards and appears in the open shift list. A popup listing nothing asks a question with no answers in it.
3. If still nobody takes it, the day runs short-staffed. An unfilled slot is never an error — it is a day that ran with fewer people, and it confirms exactly like any other.

**Inside five days, neither 1 nor 2 fires.** Step 5's freeze holds for a cancellation exactly as it holds for a dropout: no Välj Utbyte popup, no Acceptera Pass cards. The slot opens, sits in the open shift list, and is filled by manual placement or a Snabb Pass. A cancellation two days out is the same emergency as a dropout two days out, and the system does not start ringing phones on its own that close in.

**Step 5c — Avboka Pass on an arbetsledare**

A leader is never simply removed. Somebody has to be answerable for the day, so taking one off forces the question of who takes their place. Pressing **Avboka Pass** on a leader in Öppna Dag opens a popup:

> **Vem ska byta ut [Arbetsledare Name]?**

- **A list of every arbetsledare not already working that day.** Selecting one replaces the cancelled leader, and the day proceeds normally from there — stage 1 belongs to the replacement.
- **If no arbetsledare is available**, the popup offers **Gör Arbetare Ansvarig**. The admin picks a worker from that shift to act as ansvarig for the day.
- **At the bottom, a small underlined text button: Ingen Arbetsledare.** The day runs with nobody answerable for it. It is deliberately the least prominent control on the popup, because it is the worst of the three outcomes and must never be the easy press.

**A day with no arbetsledare skips stage 1 entirely.** There is no leader claim to be made, so nothing enters any leader's Bekräfta Pass queue. The day goes directly to the admin's confirmation queue, **flagged**:

- Highlighted in the queue, not mixed in with ordinary stage 2 review.
- A notification goes to the admin.
- **Admin and only admin confirms it.** Not the project's other leaders, not the ansvarig worker. The worker was covering, not supervising, and a leader who was not there has no more standing than the owner does.

**The record tells the two apart.** `confirmed_via` distinguishes a day a worker covered as ansvarig from a day nobody was responsible for. Both are flagged and both are admin-only, but they are different admissions about how the day ran, and collapsing them into one value loses the part that matters.

**Generating before the admin confirms a flagged day raises the bristsurvey for that day alone** (Section 1). The rest of the range is already satisfied, so the survey narrows to the one day that is not.

**Step 6 — The day happens**
Workers clock themselves in and out. The timestamp is the server's, never the phone's — a phone running ten minutes fast writes ten minutes of error into evidence of hours worked and nobody would notice.

A pass that is scheduled but not started, and one that is in progress, are told apart by whether a clock-in exists, not by a separate state.

**Step 7 — Snabb Pass, the escape hatch**
**Admin only.** Bypasses the entire priority list. Requires only a name. For last-second dropouts, verbal arrangements, covering a no-show. **On paper it is an ordinary shift** — it prints in the Arbetsdagbok exactly like any other row. Only the way it enters the system differs. It still enters the confirmation queue; Snabb Pass skips the picking, never the confirming. If that person held an assignment elsewhere that day, the Snabb Pass wins and the earlier one is released.

**Step 8 — Confirmation, in two stages**

This is the mechanism everything else exists to feed. Without it there is no Arbetsdagbok — the admin cannot generate a document covering any window the arbetsledare has not confirmed.

Confirmation happens twice. The leader states what happened; the admin reviews the statement. Two statuses on the day record, `leader_confirmed` and `admin_confirmed`, and the document needs only the first.

---

**Stage 1 — the arbetsledare**

**Trigger.** A day becomes confirmable the minute its last shift has ended. Not at midnight, not the next morning — when the final shift on that day is over by the clock.

**Who.** The arbetsledare assigned to that project. Assignment is set by the admin at project creation, and a project may have several. An arbetsledare sees only the days belonging to projects they are on.

**What they do here:**

- Clock themselves in and out, on their own auto-assigned row (Step 4b) as much as anyone else's.
- Correct times and hours on every row.
- Mark a row late.
- Write the day's "Vad Vi Gjorde" text.
- Remove someone who was not actually there.

**The list.** Days, oldest first, each headed by its date and weekday:

```
AUG 16 MÅNDAG
[Arbetare]   [start]   [slut]   [timmar]
```

Every field on the row is editable. Start time, end time, hours worked — the leader corrects whatever is wrong.

**One row, one late mark.** If any of the three fields is edited, the row is logged late — once. Editing all three is still one mark. Three corrections to one person's shift is one deviation, not three, and the priority-list demotion moves them one position, not three.

**Before a day can be confirmed**, the leader writes a few words about what that day's workers did. This is the "Vad Vi Gjorde" text, mandatory, one per project per day, and it prints on every row of that day's table in the document.

**Removing someone who wasn't there.** If a person on the list did not actually work that shift, the leader removes them from the day here. That is different from deleting a shift — it corrects the record of who was present.

**Confirming writes `leader_confirmed`.** The day leaves the leader's queue, and the leader cannot edit it again. **Stage 1 is final for them.** The only thing that puts the day back in their hands is the admin rejecting it.

**The Arbetsdagbok can be generated from here.** The admin does not have to have looked at the day first.

---

**Stage 2 — the admin**

Every `leader_confirmed` day arrives in the admin's review queue. Three outcomes, no fourth:

- **Approve.** The day becomes `admin_confirmed`. Terminal.
- **Edit and approve.** The admin corrects the figures first, then approves. `admin_confirmed`, carrying his values.
- **Reject and send back.** The day returns to the arbetsledare, who works it and confirms again. This is the only route that reopens a confirmed day.

**Stage 2 is review, not confirmation.** The admin cannot make a stage 1 claim about a day; he can only accept, correct, or refuse the claim a leader already made. The distinction is the point — an owner who could confirm from nothing would rubber-stamp days he was not present for. The routes that do reach `admin_confirmed` without a leader (bristsurvey, a flagged day) exist because there was no leader claim available to review, not because the admin outranks one.

**An edit after generation.** If the document was already produced from the `leader_confirmed` figures and the admin then edits at stage 2, Bekräftelse Historik shows the new figures. The PDF does not change — it is a snapshot. Regenerating the range is how a corrected document is obtained.

---

**Everything on these screens exists for the document.** The time edits, the hours edits, the removals, the "Vad Vi Gjorde" text — none of it is bookkeeping for its own sake. Each one lands in a cell of the Arbetsdagbok. That is why each stage is final once passed, and why nothing generates until stage 1 is done.

A day can be confirmed understaffed. The day passed; that is a fact worth recording.

If unconfirmed days exist, a full-screen popup appears on app open, oldest first. Its dismiss control fades in after one second.

**Step 9 — Arbetsdagboken**
The admin opens the project, sets the date range — projects have no fixed end date, so a range has to be chosen per export — and downloads the PDF. Generation is blocked per Section 1's rule.

That block is the entire enforcement mechanism. The admin needs the document; only the leader can unblock it, by confirming at stage 1. The chasing happens in real life, outside the app.

---

## 5. Invariants — non-negotiable

1. **Hours are typed by a human.** Nothing derives them. Not from clock stamps, not from the span. Unpaid lunch makes span ≠ hours the normal case. An auto-assigned leader's hours are *prefilled* from the workers' envelope and stay editable — a number a human must accept or correct is not a derived number, and nothing writes hours nobody looked at.
2. **No worker holds two assignments on the same date.** Ever. **One exception, arbetsledare only:** a leader auto-assigned to two projects (Step 4b) holds a day on each. Nothing but auto-assignment creates it, and it does not extend to arbetare.
3. **Clock stamps are append-only evidence.** The leader may overwrite the working value; the original survives, visible and attributed.
4. **An arbetare never writes hours or confirmation state.** A leader writes them at stage 1; the admin writes them at stage 2 and on the two routes that reach `admin_confirmed` with no leader behind them. Enforced in the database, not the interface. The worker side of this has not moved, and it is the side that matters.
4b. **An arbetsledare confirms only for projects they are assigned to.** This is a per-row scope, not a role check — the database must enforce it row by row. **A flagged day (Step 5c) is outside every leader's scope**: admin and only admin confirms it.
5. **Confirmation is final at each stage.** A leader cannot edit a day after confirming it — stage 1 is final for them. The day is not finished until the admin approves it: stage 2 may edit and approve, or reject it back to the leader, which is the only thing that reopens a day. Once `admin_confirmed`, nothing edits it. One wall became two, and the leader still cannot climb back over the first.
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

## 7. Landing pages and navigation

Each role lands on what it does most, and nothing important is more than one press away.

### Admin

**Landing page** — three buttons, then the list:

- **+ Nytt Projekt**
- **+ Skapa Pass**
- **+ Snabb Pass**
- Below them, **Alla Project**: every project as a row — name, address, hours.

The list is the work. Those three buttons sit above it because creating is the only thing an owner does that a list cannot show him.

**Hamburger menu**, top left:

- Kalender
- Alla Project
- Alla Pass
- Alla Arbetare — **+ Ny Arbetare** lives inside it, not on the landing page

**Top right:** the profile icon.

The Arbetsdagbok is not in either place. It lives inside the project (Section 1).

**The menu slides down from the top.** The background darkens behind it. Tapping outside closes it. It arrives from the top because that is where the button is, and a panel that appears somewhere other than the thing you pressed makes people hunt for it.

### Arbetsledare

**Landing page:**

- **+ Skapa Pass**
- **Bekräfta Pass** — a widget, not a link. A live preview of the days actually waiting, with a red dot whenever anything is pending. Tapping it opens the full page. A leader should see the size of the debt without pressing anything.
- **Nästa Pass** — a card for their next shift: map, project name, address, date. **Read only. No accept, no deny.** A leader's days are auto-assigned (Step 4b), so there is nothing to accept, and a button that only ever agrees with what is already true teaches people to press without reading.

**Hamburger menu**, top left:

- Min Pass Kalender
- Mina Pass

**Top right:** the profile icon.

Alla Projekt and Alla Arbetare stay reachable for a leader, off-menu.

### Arbetare

**Not finalised.** Untouched, as it stands: Hem (own shifts, own confirmed hours this month, clock control) · Min kalender (förval) · Acceptera Pass · Min profil.

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
- The arbetsledare is auto-assigned to any day their project has a worker on it, both leaders if a project has two. Times are the workers' envelope, hours are prefilled from it and editable, and the row prints like any other. This replaces Acceptera Pass for leaders entirely.
- A leader may hold two projects on one date. Invariant 2's only exception.
- Avboka Pass on a leader forces a replacement choice: another arbetsledare, a worker as ansvarig, or nobody. Avboka Pass on a worker offers Välj Utbyte, and falls through to Acceptera Pass and the open shift list when nobody has pre-picked — never inside five days.

**Identity**
- Every worker has an account; not every account has a worker.
- Snabb Pass creates a real worker and a real account through the same form.
- Passwords: 6 to 20 characters, keyboard-accessible on phone and desktop.
- Recovery is the admin regenerating and re-copying. No self-service reset.

**Two-stage confirmation**
- Stage 1 is the leader's: clock in and out, confirm the day, write Vad Vi Gjorde, edit times, mark late. Status `leader_confirmed`.
- Stage 2 is the admin's: approve, edit and approve, or reject back to the arbetsledare. Status on approval `admin_confirmed`.
- The Arbetsdagbok generates from `leader_confirmed`. Stage 2 is not a gate.
- Generating moves the days to Bekräftelse Historik whatever their stage.
- A stage 2 edit after generation shows in Historik. The PDF is a snapshot and does not change.
- A day that ran with no arbetsledare is flagged, skips stage 1, and only the admin can confirm it.

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
- Öppna Dag opens from the calendar only. No standalone page, no landing-page button.
- The Arbetsdagbok lives inside the project. Direct download, no print dialog, named `19Aug-22Aug-2026-landskrona.pdf`.
- Landing pages and hamburger menus are settled for admin and arbetsledare (Section 7). The arbetare landing is not finalised.

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

**The export is a direct download, not a print dialog** (Section 1). Whatever produces the file still has to reproduce this paging behaviour exactly: the repeating header and footer, the reserved 30mm band, day blocks that do not split across a page break. The print CSS above is the specification of the page, not merely instructions to a browser's print command.

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
- The two confirmation stages as separate statuses, and `confirmed_via` as an axis separate from both. Route and stage answer different questions; one column cannot carry both.
- The flagged day: admin-only confirmation for a day no leader was on, distinguished in the record from a day a worker covered as ansvarig. Losing that distinction turns an admission into a normal day.

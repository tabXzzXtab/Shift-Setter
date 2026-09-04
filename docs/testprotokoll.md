# Shift Setter — Testprotokoll

Every function that is actually built, divided into blocks of work. Each block is
self-contained: it names who you log in as, what has to exist before you start,
and what the result of each step should be.

Steps are lettered by block (`F3` = block F, step 3) so the work can be handed
out without renumbering anything.

---

## How the work divides

| Block | The thing to be done | Log in as | Needs first | Steps |
|---|---|---|---|---|
| **A** | Automated checks, then start the app | Terminal | — | 7 |
| **B** | Login and the role boundaries | All three | A | 5 |
| **C** | Creating workers and their accounts | Admin | A | 4 |
| **D** | Creating a project | Admin | C | 2 |
| **E** | Förval — the worker's availability | Arbetare | B | 3 |
| **F** | Skapa pass — creating the demand | Arbetsledare | D, E | 7 |
| **G** | Who got the work: tiers, offers, the race | 2× Arbetare | F | 6 |
| **H** | Clocking in and out | Arbetare | F | 4 |
| **I** | Calendar, Öppna dag, taking people off | Admin + Ledare | F | 9 |
| **J** | Stage 1 — the leader confirms a day | Arbetsledare | F, H | 6 |
| **K** | Arbetsdagbok over a clean range | Admin | J | 6 |
| **L** | Bristsurvey — generating over an unconfirmed day | Admin | F (not J) | 6 |
| **M** | Snabb Pass | Admin + Ledare | D | 5 |
| **N** | Final sweeps | Admin + Arbetare | all | 3 |

**Splitting it across people.** A → F must run in order, once, by one person.
After F is done, three tracks can run in parallel: **G + H** (a worker),
**I + M** (the admin), **J** (the leader). **K** needs J finished, and **L**
needs a past day that J deliberately left alone. **N** goes last.

**Two blocks need two people at once:** G (the race, G4) and I (the admin
deletes, the worker watches for the notice).

---

## Before you start

**Three browsers.** One normal window and two private windows, so you can stay
logged in as admin, arbetsledare and arbetare at the same time. You will switch
between them constantly.

**Logins** — the passwords live in `.env.local`, which is gitignored:

| Role | Credentials | Name |
|---|---|---|
| Admin | `WALKTHROUGH_ADMIN_EMAIL` / `_PASSWORD` | — |
| Arbetsledare | `DEMO_LEADER_EMAIL` / `_PASSWORD` | Lena Ledare |
| Arbetare | `DEMO_WORKER_EMAIL` / `_PASSWORD` | Arvid Arbetare |

**The one thing that makes the whole run work.** In block F you pick five days:
**the day before yesterday, yesterday, today, and two future days.** The two past
days are what blocks J, K and L need — one gets confirmed, one is deliberately
left unconfirmed for the bristsurvey. Today is what block H clocks into. The
future days are what block I deletes and reassigns. Pick only future days and
most of this protocol has nothing to test.

---

## Block A — Automated checks, then start the app

**Terminal. No login needed.**

- [ ] **A1.** Run `npm run db:check`
      → **Ska hända:** no drift. If it *does* report drift, **stop here** —
      something outside this repo changed the database, and the reason matters
      more than the fix.

- [ ] **A2.** Run `npm run test:db`
      → **Ska hända:** the suite passes, and every negative control fails at the
      one assertion its guard holds up. Everything rolled back.

- [ ] **A3.** Run `npm run verify`
      → **Ska hända:** lint, typecheck and the static build all finish clean.

- [ ] **A4.** Run `npm run test:race`
      → **Ska hända:** two workers grab the same last slot every round, and
      exactly one wins every time.

- [ ] **A5.** Run `npm run demo:reset`
      → **Ska hända:** demo data cleared, then Lena Ledare, Arvid Arbetare and
      Demoprojektet recreated with the passwords from `.env.local`.

- [ ] **A6.** Run `npm run dev` and open `http://localhost:3000/Shift-Setter/`
      → **Ska hända:** the login screen headed **Shift Setter**. Note the
      `/Shift-Setter` path — the bare root will not serve.

- [ ] **A7.** *(Optional)* Run the scripted browser suites — they drive the same
      ground you are about to cover by hand:
      `npm run walkthrough` · `walkthrough:tiers` · `walkthrough:batch` ·
      `walkthrough:snabb` · `walkthrough:kalender` · `walkthrough:brist` ·
      `node scripts/long-doc-check.mjs` ·
      `node scripts/pdf-download-check.mjs <from> <to>`
      → **Ska hända:** each finishes without throwing and leaves screenshots in
      `artifacts/`.

**Done when:** all four suites are green and the login screen is up.

---

## Block B — Login and the role boundaries

**All three logins.**

- [ ] **B1.** Log in with a deliberately wrong password.
      → **Måste vägras:** *"Fel e-post eller lösenord."* — and it says nothing
      about whether the account exists.

- [ ] **B2.** Log in as the admin.
      → **Ska hända:** screen headed **Admin** with seven buttons: Nytt projekt,
      Ny arbetare, Alla projekt, Snabb Pass, Arbetsdagbok, Skiftkalender,
      Öppna dag.

- [ ] **B3.** Log in as Lena in the second browser.
      → **Ska hända:** **Arbetsledare** — Skapa pass, Skiftkalender, Öppna dag,
      Bekräfta pass, *plus* Mina pass, Min kalender and Acceptera pass, because a
      leader is also a worker.

- [ ] **B4.** Log in as Arvid in the third.
      → **Ska hända:** **Arbetare** with three buttons only: Mina pass,
      Min kalender, Acceptera pass. No Bekräfta pass, no Skiftkalender, no
      project buttons.

- [ ] **B5.** As Arvid, type `/Shift-Setter/kalender` straight into the address
      bar.
      → **Måste vägras:** the page loads but shows only a notice that the
      calendar is the company's schedule and his own shifts are under Mina pass.
      No shifts, no names, no projects.

**Done when:** each role lands on its own screen and the worker cannot reach the
company schedule by URL.

---

## Block C — Creating workers and their accounts

**Admin.**

- [ ] **C1.** Ny arbetare → fill in Namn and E-post → reach for **Tillverka
      arbetare**.
      → **Måste vägras:** it is still disabled. An account whose credentials
      nobody holds is an account nobody can use.

- [ ] **C2.** Press **Kopiera inloggning**.
      → **Ska hända:** a block appears on screen and on the clipboard — Länk,
      Namn, Email, Lösenord (six digits) — the button reads *"Kopierad ✓"*, and
      **Tillverka arbetare** is now pressable.

- [ ] **C3.** Press **Tillverka arbetare**. Do this twice — create **Bertil** and
      **Cecilia**.
      → **Ska hända:** *"Bertil skapad"* with the credential block shown once
      more, and a **Skapa en till** button.

- [ ] **C4.** Log in as Bertil in a private window with the password you copied.
      → **Ska hända:** he lands on the **Arbetare** screen. Creating the worker
      created the account — there is no second step and no email to wait for.

**Done when:** Bertil and Cecilia exist and can both log in.

---

## Block D — Creating a project

**Admin.**

- [ ] **D1.** Nytt projekt → fill everything *except* **Beställarens org
      nummer** → **Skapa projekt**.
      → **Måste vägras:** the form will not submit and nothing is created. A
      blank org nummer discovered months later is not recoverable.

- [ ] **D2.** Fill all eight fields, choose Lena as arbetsledare, press **Skapa
      projekt**.
      → **Ska hända:** you land on Alla projekt and the new project is a row
      there, with its name, site address and start date.

**Done when:** the project exists with Lena assigned to it.

---

## Block E — Förval, the worker's availability

**Arbetare (Arvid).**

- [ ] **E1.** Min kalender → **Kan jobba** selected → drag across the day before
      yesterday through two days ahead.
      → **Ska hända:** every day you cross goes solid black and the line below
      reads *"Sparas automatiskt."*

- [ ] **E2.** Drag back over one of the black days.
      → **Ska hända:** it clears to white — *"Inte sagt"*. Going over a day again
      undoes it.

- [ ] **E3.** Press **Kan inte**, tap one more day, then reload the page.
      → **Ska hända:** that day is hatched, the others are still black, and all
      of it survived the reload.

**Done when:** Arvid has marked the days block F is about to use, plus one
`Kan inte` day for G6.

---

## Block F — Skapa pass, creating the demand

**Arbetsledare (Lena).** This is the block everything downstream depends on.

- [ ] **F1.** Skapa pass → on the full-screen calendar tap **the day before
      yesterday, yesterday, today, and two future days**.
      → **Ska hända:** the button fixed in the top corner shows **5** and becomes
      pressable. Press it.

- [ ] **F2.** Open the **Projekt** dropdown.
      → **Ska hända:** only projects Lena is assigned to are listed. A leader on
      no project gets an empty list and can create nothing.

- [ ] **F3.** Row 1 reads 07:00–16:00. Change **Slutar** to 15:00.
      → **Ska hända:** Timmar was prefilled **8,5** and re-suggests **7,5** — the
      span minus a thirty-minute break.

- [ ] **F4.** Type **7** into Timmar yourself, then change **Slutar** to 17:00.
      → **Ska hända:** Timmar stays **7**. Once a human types a figure the span
      never touches it again — that is the whole of invariant 1.

- [ ] **F5.** Set the headcount to 2, add a second row with **+ Lägg till rad**,
      and read the summary line.
      → **Ska hända:** *"2 rad(er) × 5 dag(ar) = 10 pass, 15 platser"*. Every row
      applies to every selected day.

- [ ] **F6.** Look above Handplocka for a shortfall notice.
      → **Ska hända:** if fewer people marked those days than there are slots:
      *"N plats(er) saknar folk som markerat dagen — sämst \<datum\>"*. Told
      while the schedule can still be changed.

- [ ] **F7.** Handplocka Arvid, then press **Skapa 10 pass**.
      → **Ska hända:** his row inverts to black when picked, and the result
      screen reads *"10 pass"* above *"N av 15 platser tillsatta"*, plus a notice
      for any places that went out as Acceptera Pass.

**Done when:** ten passes exist across five days, two of them in the past.

---

## Block G — Who got the work: tiers, offers, the race

**Two arbetare at once (Bertil and Cecilia).** G4 needs both browsers open.

- [ ] **G1.** As Arvid: Mina pass.
      → **Ska hända:** he holds shifts on days he marked **Kan jobba**, and
      **never two on one date**. Hand-picking gave him rank, not a grant.

- [ ] **G2.** As Bertil, who marked nothing: Acceptera pass.
      → **Ska hända:** cards showing date, project, address, Tider and Timmar —
      everything he needs to answer without asking anyone.

- [ ] **G3.** Press **Ta passet** on one card.
      → **Ska hända:** *"Passet är ditt."*, the card is gone, and the shift is
      now in his Mina pass.

- [ ] **G4.** Open the same last open slot as Bertil *and* as Cecilia, then press
      **Ta passet** in both within a second.
      → **Måste vägras:** exactly one gets *"Passet är ditt."*; the other gets
      *"Någon annan hann först. Passet är taget."* Never both.

- [ ] **G5.** Press **Nej tack** on another card, then reload.
      → **Ska hända:** the card is gone and does not come back.

- [ ] **G6.** Check the queue of the worker who marked a day **Kan inte**.
      → **Måste vägras:** no card for that date, ever. An explicit no is not
      asked again.

**Done when:** the slots are filled or offered, and the race produced exactly one
winner.

---

## Block H — Clocking in and out

**Arbetare (Arvid).**

- [ ] **H1.** Mina pass → today's shift → **Stämpla in**.
      → **Ska hända:** *"Stämplade in"* fills with the current Stockholm time. It
      is the server's clock, never the phone's.

- [ ] **H2.** Press **Stämpla ut**.
      → **Ska hända:** the out time fills and the card reads *"Klart för dagen"*
      with no buttons left.

- [ ] **H3.** Read the **Timmar** row on that same card.
      → **Ska hända:** *"Inte bekräftat än"* — not a blank, and not a number.
      Clocking is evidence, not hours.

- [ ] **H4.** Check that yesterday's shift is still on the list, and clock in and
      out on it too.
      → **Ska hända:** today *and* yesterday are both clockable — the soft window
      that keeps a night shift and a bad-signal catch-up working.

**Done when:** at least one past day has real clock stamps for block J to show.

---

## Block I — Calendar, Öppna dag, taking people off

**Admin, with the leader and a worker on hand.**

- [ ] **I1.** Admin → Skiftkalender.
      → **Ska hända:** each project has its own colour, and a run of consecutive
      days is **one unbroken band** with the project name written once, on its
      first day.

- [ ] **I2.** Find a day where two projects run and compare them.
      → **Ska hända:** two clearly different colours from the fixed palette —
      never two neighbouring greens.

- [ ] **I3.** Tap a day.
      → **Ska hända:** the day opens inline, listing every pass with its project,
      times and *"X av Y platser"*. There is no way in other than tapping a day.

- [ ] **I4.** **Ändra detta pass** → change the times → **Spara**. Then look at
      the same pass on the next day.
      → **Ska hända:** *"Passet är ändrat. Övriga pass är orörda."* and the next
      day's pass is genuinely unchanged — a batch makes independent passes, not a
      series.

- [ ] **I5.** Press 🗑 beside a worker on a pass **more than five days out**.
      → **Ska hända:** *"… Platsen öppnades igen: N tillsatt, M fick Acceptera
      Pass."* The slot reopened; the headcount did not drop.

- [ ] **I6.** Do the same on a pass **inside five days**.
      → **Ska hända:** *"Passet är inom fem dagar, så platsen fylls inte
      automatiskt — sätt in någon själv."* Nobody is ready for a last-minute
      change.

- [ ] **I7.** As Lena, open the same day and look for **Ta bort detta pass**.
      → **Måste vägras:** the button is not there. Deleting a shift is the
      admin's alone.

- [ ] **I8.** As admin, press **Ta bort detta pass** on a future pass someone
      holds, then open that worker's Mina pass.
      → **Ska hända:** *"Passet är borttaget."* here, and on his screen a black
      notice: *"Ditt pass \<datum\> är borttaget."* with an **Okej** button. It
      is never offered back to him.

- [ ] **I9.** Press **Ta bort detta pass** on a pass that has already started or
      been clocked into.
      → **Måste vägras:** *"Passet har redan börjat och kan inte tas bort. Det
      ska bekräftas i stället."* A started day is a fact, not an entry.

**Done when:** both cascade branches fired, and a deletion reached the worker.

---

## Block J — Stage 1, the leader confirms

**Arbetsledare (Lena).** **Confirm one day only** — block L needs the other past
day left alone.

- [ ] **J1.** Bekräfta pass.
      → **Ska hända:** the **oldest** day whose last shift has already ended by
      the clock, headed with its date and project. Today's unfinished shift and
      every future day are absent.

- [ ] **J2.** Read one worker's row.
      → **Ska hända:** *"Stämplade 07:02 till 16:04"* where they clocked, dashes
      where they did not — shown, but never turned into hours by itself.

- [ ] **J3.** Leave **Vad vi gjorde** empty and try to confirm.
      → **Måste vägras:** **Bekräfta dagen** stays disabled. The document has no
      empty cells, and this text prints on every row of the day.

- [ ] **J4.** Correct one row's Timmar to 7,5, write a few words, press **Bekräfta
      dagen**. When the next day loads, **stop**.
      → **Ska hända:** the next unconfirmed day loads straight away. Leave it —
      it is block L's material.

- [ ] **J5.** Reload Bekräfta pass and go looking for the day you just confirmed.
      → **Måste vägras:** it is gone, with no route back to it. Stage 1 is final
      for the leader.

- [ ] **J6.** As the admin, go looking for any way to confirm a day.
      → **Måste vägras:** there is no Bekräfta pass button on the admin screen at
      all. The owner cannot make a claim about a day he was not on.

**Done when:** exactly one past day is confirmed and one is still open.

---

## Block K — Arbetsdagbok over a clean range

**Admin.** Needs block J finished.

- [ ] **K1.** Arbetsdagbok → pick the project → set Från and Till to cover **only
      the day J confirmed** → **Generera Arbetsdagbok**.
      → **Ska hända:** **no popup at all.** The preview appears straight away. A
      warning that fires when nothing is wrong is one nobody reads.

- [ ] **K2.** Press **Ladda ner PDF**.
      → **Ska hända:** the file downloads with no print dialog, named like
      `03Sep-04Sep-2026-demoprojektet.pdf` — capitalised month, lower-case
      project slug — and *"Nedladdad: …"* appears.

- [ ] **K3.** Add up the confirmed hours by hand, then open the PDF cover.
      → **Ska hända:** beställarens adress, bolag and org nummer all printed, the
      project name, **Ordinarie tid** equal to your own sum, and **Ort & datum
      and Signatur blank** — those are signed by hand.

- [ ] **K4.** Scroll to page 2 and beyond.
      → **Ska hända:** one block per day with the columns ARBETARE · PASS TIMMAR
      · PASS TIDER · VAD VI GJORDE, the day's text repeated on every row, logo,
      title and footer on **every** page, and no day block split across a break.

- [ ] **K5.** Set a range that overlaps the one you just documented.
      → **Ska hända:** *"Du har redan gjort en arbetsdagbok som dokumenterar …"*
      as a notice — a warning, not a block. Re-issuing is legitimate; doing it
      unknowingly is not.

- [ ] **K6.** Switch to Arvid → Mina pass → the day that was just filed.
      → **Ska hända:** Timmar now shows the real number, exactly what was filed.
      Before the document it said *"Väntar på arbetsdagbok"*.

**Done when:** a correct PDF is on disk and the worker can finally see the hours.

---

## Block L — Bristsurvey, generating over an unconfirmed day

**Admin.** Needs the past day block J deliberately left open.

- [ ] **L1.** Pick a range containing that unconfirmed day → **Generera
      Arbetsdagbok** → press **Nej**.
      → **Ska hända:** the page darkens and the warning about booking unconfirmed
      hours and incorrect times appears. **Nej** takes you to Alla projekt and
      nothing is generated.

- [ ] **L2.** Repeat, press **Ja**, then press **Tillbaka**.
      → **Ska hända:** a screen naming who owes the confirmation — *"… har inte
      blivit bekräftade av Lena Ledare"* — with the heavy button being the one
      that leaves. Nothing is generated.

- [ ] **L3.** Repeat, **Ja**, then **Bekräfta Uppgifter**.
      → **Ska hända:** one question per day — *"Vad har ni uppfyllt på
      \<projekt\> den \<Måndag 19:e Aug\>?"* — with *"N dagar kvar"* above it.

- [ ] **L4.** Try to edit the figures under *"Registrerat — bokförs som det
      står"*.
      → **Måste vägras:** they are read-only, each marked *(stämplat)* or
      *(planerat)*. Typing them would be a stage 1 claim by another name.

- [ ] **L5.** Write a description, press **Bekräfta dagen**, and repeat for each
      day it asks about.
      → **Ska hända:** each answer loads the next day, and when the last one is
      answered the document generates by itself.

- [ ] **L6.** Switch to Lena → Bekräfta pass and look for the surveyed day.
      → **Måste vägras:** it is not in her queue and never returns. The admin took
      the shot; the day is closed.

**Done when:** the gap was closed by hand and the document came out the far side.

---

## Block M — Snabb Pass

**Admin, plus Lena for M1.**

- [ ] **M1.** As Lena, open `/Shift-Setter/snabb`.
      → **Måste vägras:** *"Endast administratören kan skapa Snabb Pass."* — and
      the database would refuse her even if the screen did not.

- [ ] **M2.** As admin → Snabb Pass → **Vem?** → **+ Ny arbetare…** → create
      someone off-roster.
      → **Ska hända:** the same copy-then-create form, then straight back to the
      shift screen with the new person already selected, as though nothing
      happened.

- [ ] **M3.** Check the Timmar field with 07:00–16:00, then type over it and
      change a time.
      → **Ska hända:** prefilled **8,5**, and once typed over it stops following
      the span — same rule as Skapa pass.

- [ ] **M4.** Choose Arvid and a date he **already** works → **Skapa Snabb
      Pass** → check that date in Öppna dag.
      → **Ska hända:** *"Arvid är inlagd på \<datum\>"*, and his earlier
      assignment that day is gone. The Snabb Pass wins; one person, one date,
      always.

- [ ] **M5.** Once that day has ended, look in Lena's Bekräfta pass.
      → **Ska hända:** the snabb pass is there like any other row. It skips the
      picking, never the confirming.

**Done when:** an off-roster person was put on a shift and the old assignment
released.

---

## Block N — Final sweeps

**Admin and arbetare. Run last.**

- [ ] **N1.** Walk Öppna dag across every date you created, reading the names.
      → **Ska hända:** no name appears twice on one date, on any project.

- [ ] **N2.** Read every screen Arvid can reach, looking for anyone else.
      → **Ska hända:** only his own rows. No colleague's name, hours or personal
      data anywhere.

- [ ] **N3.** Run `npm run test:db` once more, then `npm run demo:reset` for a
      clean board.
      → **Ska hända:** still green after everything you did by hand, and the demo
      logins keep working after the reset.

**Done when:** the suite is green and the board is clean.

---

## Not built yet — nothing here to test

These are in [the spec](spec.md) but not in the code, so their absence is not a
bug. Do not spend time hunting for them.

- **Stage 2** — the admin's review queue: approve, edit and approve, or reject
  back to the leader.
- **Bekräftelse Historik** — where generated days are supposed to land.
- **Step 4b** — the arbetsledare being auto-assigned to any day their project has
  a worker on it.
- **Step 5c** — Avboka Pass on a leader, Byta Plats Med Arbetsledare, Gör
  Arbetare Ansvarig, Ingen Arbetsledare, and the flagged admin-only day that
  follows.
- **Välj Utbyte** — the replacement popup when a worker comes off. Today the slot
  cascades automatically, with no popup.
- **Papperskorgen** — soft delete and restore for projects and workers.
- **The real landing pages** — hamburger menus, the Bekräfta Pass widget, Nästa
  Pass, Mina Pass with its project filter, the profile screen.
- **The unconfirmed-days popup** on app open, and offer notifications. Only a
  deleted shift notifies today.

One dead branch worth knowing about: the bristsurvey's *"Uppgifter saknas om
projektet"* screen cannot be reached from a valid project, because the
`btrim(...) <> ''` check constraints make a blank beställare field impossible to
store in the first place.

# Shift Setter — design handoff (all roles)

Swedish construction shift scheduling. Three roles, one visual system. The product
exists to produce one document correctly: the **Arbetsdagbok**. Every screen here
either fills its cells or moves a day toward being confirmed.

## How to use this package

The files under `screens/` are **design references authored in HTML**, not production
code. Each `.dc.html` is a streaming component format used by the design tool; treat it
as a spec of markup, values and behaviour. **Rebuild the screens in the target
codebase's own environment** (React Native, SwiftUI, Compose, React web…) using its
components, navigation and styling conventions. Do not ship this HTML.

Fidelity: **high**. Every colour, size, weight, letter-spacing, radius, shadow, padding
and tap height below is final — reproduce the values exactly.

```
handoff/
  README.md                 this file — the whole spec
  styles.css                token entry point (imports tokens/*)
  tokens/                   the same values as CSS custom properties
  screens/arbetare/         worker: home + my shifts, calendar, open shifts, profile
  screens/admin/            admin: 13 screens
  screens/ledare/           arbetsledare (foreman): 8 screens
```

Open any `.dc.html` directly in a browser to see the screens. `support.js` is the
runtime the design files need; `image-slot.js` powers one placeholder. Neither belongs
in production.

---

## 1. The design language

Light, quiet, heavy where it counts. Cards on a warm-free pale blue ground, no borders
anywhere — a soft shadow *is* the edge. One accent, used only on numbers that change
and on the single most important action per screen. Radii are small and consistent;
nothing is pill-shaped except status tags.

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| ink | `#091540` | Primary text, icon strokes |
| ink-hover | `#12206b` | Hover for ink fills; label colour on pale-blue buttons |
| accent | `#1b2cc1` | Primary action fill, live dot, counts, durations, selected day |
| accent-soft | `#7692ff` | Non-text marks only |
| accent-pale | `#abd2fa` | Tint marks only |
| text-secondary | `#4a5578` | All secondary copy, section labels, kickers, weekday letters |
| chevron / disabled ink | `#8b98c4` | Chevrons, inactive dot, disabled button labels |
| ground | `#f3f6fd` | Screen background |
| surface | `#ffffff` | Cards |
| panel | `#e7edfb` | Empty states, segmented-control track |
| panel-2 | `#eef3fe` | Inset panels, inputs, secondary buttons |
| row-hover | `#f6f9ff` | List row hover |
| icon-hover / pressed | `#f0f5ff` / `#dbe4f9` | Icon-button states |
| hairline | `#e3eafb` | Row dividers, disabled fills |
| live | `#146b41` on `#e4f0e8` | Confirmed / approved / autosaved |
| warn | `#5c3305` + `#7a4407` on `#fdf2e3` | "No foreman on this day", override notices, Arbetsledare role tag |
| stop | `#8e1d15` on `#fbe9ec` | Delete, unavailable days, "Krävs" |
| project chips | `#1b2cc1` `#0f6f7a` `#6c3fc5` `#1f7a3d` `#8a5300` `#8e1d15` `#0a5ea8` `#7a3f8f` | Calendar project bars + legend |

Contrast rules that must hold: `#7692ff`, `#abd2fa` and `#8b98c4` are **never text**
(the last one only for disabled labels). All secondary copy is `#4a5578` — about 7:1 on
white, 6:1 on the panels.

### Type

Inter (or the codebase's UI font). Tabular figures wherever a number can change.

| Role | Spec |
| --- | --- |
| Display XL | 34px / 800 / −1.4px — the hero number (shift span, "2 dagar") |
| Display L | 26px / 800 / −0.9px — screen subject (project name on a review screen) |
| Display M | 23px / 800 / −0.5px — primary action label |
| Hours input | 26px / 800 / −0.6px — typed hours; the biggest thing in its card |
| Title L | 22px / 800 / −0.7px — screen title next to the back button |
| Title M | 18–19px / 700 / −0.4px — card subject, list row heading |
| Row label | 17px / 700 / −0.2px — grouped list rows |
| Body | 16px / 600 (inputs) · 15px / 500 (copy) — never below 15px |
| Kicker | 12px / 700, +1px, uppercase — section labels, day headers, field labels |
| Tag | 12px / 700, +0.4px — status pills |

### Spacing, radius, elevation

- Gutter 16px on every screen. Card padding 18–20px. Divider inset 18px from the left.
- Block rhythm: 14px between adjacent cards, 26px between sections. Section label sits
  **outside** its card, 10px above it.
- Radius: 9 map · 10 buttons/inputs/inset panels · 11 icon buttons · 12 primary buttons
  and segmented track · 14 grouped cards & empty states · 15 offer card · 16 hero and
  form cards · 22 sheet/phone · 999 tags.
- Shadow: flat `0 1px 3px rgba(9,21,64,.08)` · group `0 4px 18px rgba(9,21,64,.07), 0 1px 2px rgba(9,21,64,.04)`
  · hero `0 8px 28px rgba(9,21,64,.09), 0 1px 2px rgba(9,21,64,.05)`
  · offer `0 10px 30px rgba(9,21,64,.10), 0 1px 2px rgba(9,21,64,.05)`
  · action `0 6px 18px rgba(27,44,193,.28)` · sheet `0 -12px 40px rgba(9,21,64,.22)`.
- Tap targets: 44 icon buttons · 44 calendar cells and segmented options · 48 min ·
  54 accept/deny · 60 list rows and secondary actions · 64–66 the one primary action.
  Nothing below 44.

### States & motion

Press `transform: scale(.985)`, ~110ms. Hover is one step of the blue ramp
(`#f6f9ff` rows, `#dbe4f9` pale buttons, `#12206b` ink/accent fills). Focus is
`2px solid #1b2cc1` on inputs, `2px solid #091540` elsewhere — never the browser
default. Disabled: `#e3eafb` fill, `#8b98c4` label, `cursor: not-allowed`.
Respect reduced-motion: drop the status-dot pulse and the press scale.

### Shared components

- **Icon button** 44×44, radius 11, white, flat shadow.
- **Sub-screen header** back icon button + 22/800 title, flush left, 14/16/12 padding.
  A one-line 15/500 `#4a5578` subtitle may sit under it, indented 72px to clear the button.
- **Grouped list card** rows 60px, 17/700 label, `#8b98c4` chevron, 1px `#e3eafb`
  divider inset 18px.
- **Empty state** `#e7edfb`, radius 14, centred; 17/700 headline + 15/500 `#4a5578` line.
- **Field** 12/700 uppercase label (+ optional 14/500 help line) over a 52px `#eef3fe`
  input, radius 10, no border, accent focus ring. Hours fields are 60px tall with 26/800 text.
- **Segmented control** 4px-padded `#e7edfb` track, radius 12; active option is a white
  9px-radius thumb with the flat shadow, 44px tall.
- **Calendar** 7-column grid, 44px cells, radius 10, no borders. Today = 2px inset ink
  ring. Selected = accent fill, white 800 numeral. Unavailable = `#fbe9ec` with a
  1.5px `#f0cdd2` inset ring and `#8e1d15` numeral. Past = transparent, `#8b98c4`,
  not tappable. Weekday letters 11px/700 `#4a5578` (weekend 600).
- **Status tag** pill, 12/700, one of the three signal pairs.
- **Bottom sheet** (menus) `#f3f6fd`, radius 22 top, 38×4 grab handle, scrim
  `rgba(9,21,64,.42)`, sheet shadow, grouped list inside, "Stäng" secondary button.

---

## 2. Screens by role

### Arbetare (worker) — `screens/arbetare/`

**Startsida** (`Arbetare Startsida.dc.html`) — the only screen with a hero card.
Status dot top-right of the card (9px; accent + `0 0 0 5px rgba(118,146,255,.20)` ring
+ 2s pulse when clocked in, flat `#8b98c4` when out; **no status text** — the dot is the
whole indicator, so production needs an accessibility label such as "Instämplad sedan 07:00").
Site line 15/600, span 34/800, then the 66px primary: "Stämpla Ut" on `#091540` when
clocked in, "Stämpla In" on accent when out. Below: grouped rows Mina Pass / Arbetsdagar;
"Nästa pass" empty state; "Acceptera pass" with an `N till` count and a card stack
(two white slabs, radius 14, height 24, at `bottom:-7px/opacity .55` and `bottom:-4px/opacity .8`).
The offer card carries a 150px map inset 16px on three sides (radius 9) — in the
prototype a drop-in placeholder, **in production the real map view** centred on the
shift address with one pin, non-interactive, with the provider's attribution. Body:
site name 21/700 left and address 15/500 flush right on one baseline; `#eef3fe` time
panel (day kicker + 20/800 span, duration 15/700 accent right); Acceptera (flex 2,
54px, accent) + Neka (flex 1, 54px, `#e7edfb`/`#12206b`).
Accept and deny both advance the queue and decrement the count; at 0 the card is
replaced by "Inga pass att svara på."

**Mina pass · Lista / Kalender, Öppna pass, Profil** (`Arbetare Skarmar.dc.html`)
- Mina pass: segmented Lista/Kalender; both tabs empty ("Inga pass ännu / Pass du
  accepterar hamnar här."). The calendar tab shows the month grid plus a selected-day
  section ("Inga pass denna dag."). In the design file the inactive tab is inert — it
  is a spec state, not a live control; wire it in production.
- Öppna pass: subtitle "Pass som saknar folk…", then day groups (kicker + `N pass`
  count) of cards: site 18/700 with duration 15/700 accent right, address 15/500,
  span 16/700 with a "1 plats kvar" pill.
- Profil: three titled cards — Kontakt (telefon, adress, postnr + stad),
  Utbetalning (clearing + kontonummer), Närmast anhörig (namn, telefon) — then a 60px
  "Har du företag?" checkbox row (26px box, radius 7, accent when checked), the 64px
  Spara, and "Namn och e-post ändras av administratören."

### Arbetsledare / foreman — `screens/ledare/Ledare Skarmar.dc.html`

Eight screens. The role's job is to confirm days, so the home hero is a **count of days
waiting**, not a clock.

- **Startsida** — hero: "Väntar på dig" kicker, `2 dagar` at 34/800, one explanatory
  line, then the 66px accent "Bekräfta pass". Below: a 60px `#eef3fe` "Skapa pass"
  button, grouped rows (Min passkalender / Mina pass / Bekräftelse historik), and the
  "Nästa pass" empty state.
- **Meny öppen** — the bottom sheet over a blurred, dimmed home.
- **Mina pass · lista** — same segmented pattern as the worker.
- **Min kalender (tillgänglighet)** — the tri-state availability grid. A segmented
  "Kan jobba / Kan inte" mode switch sets what a tap writes; tapping a day already in
  that state clears it back to "Inte sagt". Cells: accent fill = kan jobba, `#fbe9ec`
  + `#8e1d15` = kan inte, `#eef3fe` = inte sagt. Below: a green "Sparas automatiskt"
  strip and a legend with live counts per state. **Fully interactive in the design file.**
- **Bekräfta pass · tomt** — empty state with a check glyph in a white 46px tile.
- **Bekräfta pass · ifylld** — day kicker + project 26/800 + address; one card per crew
  member with a status tag ("Stämplad ut" green / "Ej utstämplad" amber), the stamped
  times as read-only 14/500 copy, editable Börjar/Slutar, and the 60px hours field at
  26/800. Then "Vad vi gjorde" with a red "Krävs" marker and the help line "Skrivs ut på
  varje rad i arbetsdagboken", the finality notice on `#eef3fe`, and the 64px
  "Bekräfta dagen".
- **Skapa pass · vilka dagar** — multi-select day picker; "Valda dagar" count in an
  inset panel; Fortsätt disabled at 0 selected.
- **Profil** — same three-card form as the worker, with an "Arbetsledare" role tag.

### Admin — `screens/admin/Admin Skarmar.dc.html`

Thirteen screens.

- **Logga in** — vertically centred: "Admin" kicker, "Shift Setter" 38/800, card with
  e-post + lösenord and the 64px Logga in; "Glömt lösenord?" link; "Konton skapas av
  administratören."
- **Startsida** — a Skapa card (accent "Nytt projekt" 60px + two `#eef3fe` halves,
  Skapa pass / Snabb pass), then "Alla projekt" with a project count and a compact
  row list: name 16/700, address 14/500, hours right — accent when non-zero,
  `#4a5578` when `0 h`.
- **Meny öppen** — bottom sheet: Kalender, Alla projekt, Alla pass, Granska pass,
  Bekräftelse historik, Inställningar.
- **Alla projekt** — one card per project: name + hours, address, "Start YYYY-MM-DD"
  and a 44px Redigera button.
- **Redigera projekt** — two titled cards (Projektet: namn, adress + help line,
  startdatum + tjänster; Beställaren: bolag, adress, org nummer, with the help line
  "Skrivs ut på arbetsdagboken"), the 64px accent "Spara ändringar", then — separated by
  26px — "Ta bort projekt" as a 56px `#fbe9ec`/`#8e1d15` button with "Går inte att ångra."
  Deletion never gets the loudest button on the screen.
- **Alla pass** — a period pager (`8 sep – 8 okt`, 40px arrows) then day groups of
  compact rows: site 16/700, time 14/500 tabular, "1 plats" pill.
- **Skiftkalender** — month grid of 64px cells; each day shows up to four 5px project
  colour bars and a `+N` overflow count at 10/700; today keeps the ink ring. A legend
  card maps 16px colour chips to project names.
- **Vilka dagar** — the admin copy of the day picker, interactive.
- **Snabb pass** — projekt + vem (with "Finns personen inte i listan — välj Ny
  arbetare"), datum, börjar/slutar, then Timmar at 26/800 with "Förifylls som tiden
  minus 30 min." The amber notice explains the override, then the 64px "Skapa snabb pass".
- **Granska pass** — like the foreman's confirm screen, but opens with the amber
  "Dagen kördes utan arbetsledare." panel (17/800 headline + 15/500 body) because only
  admin can confirm it.
- **Historik** — one card per confirmed day: day kicker + green "Godkänd" pill,
  project 22/800, the approval chain as 15/500 copy, an `#eef3fe` panel listing each
  person with `07:00–12:05 · 4,58 h`, the note, and "Godkänd 2026-09-08".
- **Ny arbetare · tom** — namn / e-post (+ help line) / roll select; both actions
  disabled with the explanation "Kopiera inloggningen först. Ett konto vars uppgifter
  ingen har är ett konto ingen kan använda." This is the one screen that documents the
  disabled pattern.
- **Ny arbetare · inloggning klar** — adds an Inloggning card with a green "Kopierad"
  tag, an `#eef3fe` block holding länk / e-post / lösenord (the password at 22/800,
  +1px tracking, tabular), a "Kopiera igen" button, then the enabled "Tillverka arbetare".
- **Konton** — a 56px accent "Nytt konto", then per account: name + role tag
  (Admin `#dbe4f9`, Arbetsledare `#fdf2e3`, Arbetare `#eef3fe`), email, and a row of
  Nytt lösenord / Kopiera / a 48px `#fbe9ec` delete icon button.
- **Admin profil** — account card (name 22/800, email, role tag, telefon, adress),
  grouped rows Byt lösenord / Kontohantering, the 64px Spara, and a 56px "Logga ut".

---

## 3. Domain rules the UI must not break

1. **Hours are typed by a human.** Nothing derives them — not from clock stamps, not
   from the start/end span. Unpaid lunch makes span ≠ hours. Never compute the hours
   field on the client; the stamped times are shown as context only.
2. **0 hours is a real answer** — it means the person did not come. Do not treat it as
   an empty field.
3. **Confirmation is final.** Once a day is confirmed nothing about it changes; the UI
   says so before the button, on both the foreman and admin review screens.
4. **A day with no foreman is admin's to confirm** — the amber panel on Granska pass
   exists to say that only admin can close such a day.
5. **The confirmation chain is: arbetsledare bekräftar → admin godkänner → arkiveras i
   en arbetsdagbok.** The history screen shows where each day sits in that chain.
6. **Accounts are created by admin**, and a created account is useless until its
   credentials are copied — hence the disabled-until-copied flow.
7. **Snabb pass bypasses the rotation** and replaces any existing shift that person has
   that day. Say it before the action, not after.
8. **Availability is advisory and autosaves.** Three states only: kan jobba, kan inte,
   inte sagt.

## 4. Accessibility

- 15px minimum body text; all secondary copy at `#4a5578`.
- Colour is never the only carrier: the availability grid pairs fill with an ✕ glyph in
  its legend, status tags pair colour with a word, and the calendar's `+N` is text.
- The worker's status dot needs a text alternative (see above).
- Focus rings are specified per control; keep them.
- Calendar cells, segmented options and every button meet 44px.

## 5. Assets

None ship with this package. All icons are inline SVG paths (hamburger, person,
chevrons, back arrow, plus, check, ✕, clock, trash) — substitute the codebase's icon set
at the same ~2px stroke with round caps. The map panel is a placeholder for the real map
view. Fonts load from Google Fonts in the design files; use the app's own UI font.

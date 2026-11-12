# Spec 03 — Konton Bulk + Merge + Share

## Goal
Make account creation scalable: bulk create, display all logins clearly, copy/share each or all.

## Create Flow
- Input screen: list of rows, each row = name field + email field
- "Lägg till rad" adds another row
- Primary button label is dynamic:
  - All arbetare → "Tillverka Arbetare"
  - All arbetssledare → "Tillverka Arbetsledare"
  - Mixed → "Tillverka Konton"
- On submit: creates all accounts, then shows the login list screen

## Login List Screen (post-creation)
- Each account shown as a card: name, email, generated password
- Each card has:
  - Copy icon → copies that single account's details to clipboard
  - Share icon → opens native iOS/Android share sheet with that account's details
- Top of screen: "Kopiera alla" button → copies ALL login details to clipboard at once
- Download as CSV button → exports all logins as a .csv file

## Visibility Rules
- Bulk account creation: visible everywhere including snabb pass context
- Features that require exactly ONE worker or ONE arbetssledare: hide in contexts where only one is needed (shift detail, project context requiring single selection)
- Snabb pass: bulk worker selection is the new default (spec 01) — bulk konton visible here

## Constraints
- Do not remove existing single-account create path — bulk is an addition
- Test: create 3 accounts at once on stresstest-ab, verify copy/share/CSV all work

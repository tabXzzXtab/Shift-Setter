# Spec 08 — Project Page CTA

## Goal
Make the project list page immediately actionable: Tillverka Projekt on top, search bar under it.

## Layout (top of project list page)
1. "Tillverka Projekt" button — full width or prominent, same project-creation flow as today (do not change the flow, just add the button here)
2. Search bar directly below it

## Search Behaviour
- Searches across: beställare name, address, arbetssledare name, project signature/number
- Real-time filter as user types
- No results → empty state: "Inga projekt hittades"
- Match highlight: orange background/underline on the matching text within each project card

## Existing Navbar Button
- Keep the existing "Tillverka Projekt" entry wherever it currently lives on the home screen — do not remove it
- This spec adds a second one on the project list page

## Constraints
- Project detail fields that are not currently visible on the front card (address, signature) must still be searchable — search runs against the data, highlight appears on the card if the card shows that field; if not shown on card, card is still returned in results
- Test on stresstest-ab: search by beställare name → correct projects filtered with orange highlight

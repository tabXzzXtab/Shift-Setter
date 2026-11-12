# Spec 02 — Snabb Pass Past Dates

## Goal
Remove the future-only date guard from Snabb Pass so admins can create passes for any past date.

## Change
- Find and remove the validation that blocks dates in the past (likely a `< today` check on the date input or on form submit)
- No lower bound — any date is valid

## Behaviour for Past-Date Passes
- Created exactly like today: unconfirmed, workers still need to fill in their own hours for arbetsdagbok
- No auto-confirm on creation
- Admin manually enters worked hours per day in arbetsdagbok as usual

## Constraints
- Do not change any other date validation elsewhere in the app
- Test on stresstest-ab: create a pass for yesterday, verify it appears correctly in dag-panel and arbetsdagbok

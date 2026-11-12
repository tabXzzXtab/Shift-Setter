# Spec 01 — Snabb Pass Bulk

## Goal
Replace single-worker Snabb Pass with a bulk flow: N workers × M days = N×M passes created in one action.

## Worker Selection
- Remove the existing worker dropdown
- Replace with a scrollable list of ALL workers (names + role tag)
- Search bar above the list filters by name in real time
- Multi-select: tap a worker to toggle selection (checkmark or highlight)
- Selected count shown: "3 valda"

## Day Selection
- Multi-select calendar or date list (same pattern as worker selection)
- Selected count shown: "2 dagar valda"

## Time & Hours
- Single start time + end time applies to ALL selected days (same for all)
- Hours field auto-calculates from time gap minus active lunch preset (see spec 04)

## Project Selection
- Same as today (dropdown or existing UI)

## Conflict Handling
- Before submitting: if any worker is already on that project-day, show a warning summary listing the conflicts
- Admin can dismiss and proceed — the conflicting combinations are skipped, rest are created

## Result
- N workers × M days passes created
- Success toast shows count: "9 pass skapade"

## Constraints
- Test on stresstest-ab first
- Uses existing `create_snabb_pass` RPC per combination (loop)
- No new RPC needed unless batch RPC is faster — keep it simple first

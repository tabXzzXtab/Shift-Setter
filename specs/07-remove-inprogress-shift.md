# Spec 07 — Remove In-Progress Shift

## Goal
Let an admin soft-delete a shift that a worker is currently clocked in to.

## Definition of "In-Progress"
A tilldelning row where clock_in IS NOT NULL and clock_out IS NULL (worker started, hasn't finished).

## Admin UI
- In dag-panel, in-progress shifts get a "Avbryt skift" (cancel shift) button — admin only, not arbetssledare
- Tapping shows a confirmation dialog: "Är du säker? Skiftet markeras som avbrutet."
- Confirm → soft-delete

## Soft Delete Behaviour
- Set a `cancelled_at` timestamp on the tilldelning row (add column if not exists)
- All original data (clock_in, hours, worker_id, etc.) is preserved
- Row is excluded from: arbetsdagbok, headcount, any active-shift displays
- Row IS visible to admin and arbetssledare in a "Avbrutna skift" section on dag-panel (collapsed by default)

## Worker Experience
- Nothing changes on the worker's screen mid-shift
- When the worker taps "Avsluta" (clock out): the clock-in/out container shows a notice — "Ditt skift avbröts av administratören"
- Their clock-out is still recorded on the cancelled row for audit purposes

## Un-cancel
- Admin can un-cancel from the "Avbrutna skift" section
- Un-cancel restores the row to active (clears cancelled_at)
- If un-cancelled after the worker already clocked out, it re-appears in arbetsdagbok normally

## Permissions
- Cancel: admin only
- Un-cancel: admin only
- Arbetssledare: can VIEW cancelled shifts, cannot cancel or un-cancel

## Migration Needed
- Add `cancelled_at timestamptz` to `tilldelning` table
- Update `database.types.ts` manually after migration

## Constraints
- Test on stresstest-ab: start a shift, cancel it as admin, clock out as worker, verify notice appears and shift absent from arbetsdagbok

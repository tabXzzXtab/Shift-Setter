# Spec 04 — Lunch/Rast Presets

## Goal
Let admins subtract a break duration from the calculated shift hours using one tap, with configurable preset values.

## Presets
- Three buttons shown on the time/hours section of a shift: 15 min | 30 min | 45 min (defaults)
- Tapping a button subtracts that value from the calculated hours field
- Only one preset active at a time; tap same button again to deselect (undo subtraction)

## Calculation
- Hours = (clock_out − clock_in) − selected_preset_minutes / 60
- Result written to the hours field (not clock_out; times stay unchanged)

## Settings Page (new)
Create a new Settings page and tab. This page is the new home for:
- **Guide** — move existing guide content here; remove guide entry from navbar
- **Företag** — move existing företag (company) settings here
- **Lunch/Rast preset values** — three number inputs labelled "Preset 1 / 2 / 3" with default 15, 30, 45
  - Admin can change to any value (minutes)
  - Values stored per bolag in a settings table or existing config mechanism
- Navbar: replace "Guide" entry with "Inställningar" (settings) pointing to this page
- Settings is the entry point for future business/app settings additions

## Constraints
- Presets are global per bolag (one set for the whole company, not per user)
- If no preset selected, hours field is unchanged
- Test on stresstest-ab: change preset to 20 min, create shift 08:00–16:00, verify hours = 7.67

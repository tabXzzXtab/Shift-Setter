# Handoff: Arbetare startsida (worker home screen)

## Overview
Redesign of the worker-facing home screen of a Swedish construction shift-scheduling
app. One screen, phone-first. It carries four jobs, in priority order:

1. Clock in / clock out of the current shift (the dominant action).
2. Navigate to Mina Pass (my shifts) and Arbetsdagar (work days / Arbetsdagbok).
3. Show the next upcoming shift (empty in the current data).
4. Answer offered shifts — accept or deny — from a stack, with a remaining count.

## About the design files
The files in this bundle are **design references authored in HTML**, not production
code. `Arbetare Startsida.dc.html` is a streaming HTML component format used by the
design tool; treat it as a spec of markup, values and behavior. **Recreate the screen
in the target codebase's own environment** (React Native, SwiftUI, Kotlin/Compose,
React web, …) using its established components, navigation and styling conventions.
If no environment exists yet, pick the appropriate stack and implement it there.
Do not ship this HTML.

## Fidelity
**High fidelity.** Colors, type sizes, weights, letter-spacings, radii, shadows,
paddings and tap-target heights below are final and exact. Reproduce them.

## Screen: Arbetare startsida

Shell: 390px design width, fluid to the device width, min-height 844px, background
`#f3f6fd`. Side gutter 16px on every block. Vertical rhythm between blocks: 6 / 14 /
26 / 26px as listed per block. Bottom padding 40px.

### 1. Top bar (sticky)
- Sticky to top, z 5. Background `rgba(243,246,253,.88)` + `backdrop-filter: blur(12px)`.
- Padding 14px 16px 10px. Layout: flex, space-between, gap 8px.
- Two icon buttons, 44×44, radius 11, background `#ffffff`, shadow `0 1px 3px rgba(9,21,64,.08)`.
  Hover `#f0f5ff`, pressed `#dbe4f9`. Left = hamburger (3 lines, 18×1.5 stroke 2.2,
  `#091540`), right = person glyph (stroke 2, `#091540`), aria-labels "Meny" / "Profil".
- Title "Arbetare": 17px / 700 / -0.2px, `#091540`.

### 2. Hero card — clock in/out
- Card: background `#ffffff`, radius 16, padding 20px 20px 18px, position relative,
  shadow `0 8px 28px rgba(9,21,64,.09), 0 1px 2px rgba(9,21,64,.05)`.
- Status dot: absolute, top 20, right 20, 9×9, radius 50%.
  - Clocked in: `#1b2cc1` + ring `0 0 0 5px rgba(118,146,255,.20)` + pulse animation
    `livedot` 2s ease-in-out infinite (opacity 1 → .35, scale 1 → .82 at 50%).
  - Clocked out: `#8b98c4`, no ring, no animation.
  - There is deliberately **no status text** — the dot is the only indicator.
- Site line: "Torget 131962", 15px / 600, `#4a5578`, margin-bottom 2px.
- Time: "07:00–16:00", 34px / 800, letter-spacing -1.4px, line-height 1.05, `#091540`,
  margin-bottom 18px. Tabular figures preferred.
- Primary action button, full width, height 66, radius 12, font 23px / 800, -0.5px,
  transition `transform .12s, background .15s`, pressed `scale(.985)`.
  - Filled variant (default): background `#091540` when clocked in, accent `#1b2cc1`
    when clocked out; text `#ffffff`; shadow `0 6px 18px rgba(9,21,64,.26)` /
    `0 6px 18px rgba(27,44,193,.28)`. Hover `#12206b`.
  - Outlined variant: 2px solid accent, transparent background, accent text.
  - Label: "Stämpla Ut" when clocked in, "Stämpla In" when clocked out.

### 3. Grouped nav card (block margin-top 14px)
- Card: `#ffffff`, radius 14, overflow hidden,
  shadow `0 4px 18px rgba(9,21,64,.07), 0 1px 2px rgba(9,21,64,.04)`.
- Two rows, each height 60 (tap target), padding 0 18px, flex space-between,
  label 17px / 700 / -0.2px `#091540`, hover background `#f6f9ff`.
  Rows: "Mina Pass", "Arbetsdagar".
- Chevron: 9×15, stroke 2.2, `#8b98c4`, round caps.
- Divider between rows: 1px `#e3eafb`, inset 18px from the left, flush right.

### 4. Nästa pass (block margin-top 26px)
- Section label outside the card: 12px / 700, letter-spacing 1px, uppercase,
  `#4a5578`, padding 0 4px 10px.
- Empty state: background `#e7edfb`, radius 14, padding 22px, centered,
  15px / 500, `#4a5578`, text "Inga kommande pass."

### 5. Acceptera pass (block margin-top 26px)
- Header row: label "Acceptera pass" (same spec as above) on the left; on the right a
  count "N till", 12px / 700, `#1b2cc1`. Hidden when the queue is empty.
- Stack illusion behind the card: two absolutely positioned `#ffffff` slabs, radius 14,
  height 24, `left/right 14px, bottom -7px, opacity .55` and
  `left/right 7px, bottom -4px, opacity .8`, each shadow `0 6px 16px rgba(9,21,64,.06)`.
- Offer card: `#ffffff`, radius 15, overflow hidden,
  shadow `0 10px 30px rgba(9,21,64,.10), 0 1px 2px rgba(9,21,64,.05)`.
  - Map panel: height 150, margin 16px 16px 0 (inset on three sides), radius 9,
    background `#e7edfb`, inner hairline `inset 0 0 0 1px rgba(9,21,64,.06)`.
    In the prototype this is a drop-in image placeholder because map tiles could not be
    fetched in the design environment. **In the app this is the real map view** (e.g.
    Leaflet/MapKit/Google Maps) centred on the shift address with a single pin, no
    controls, non-interactive, plus the provider's required attribution.
  - Body padding 16px 20px 20px.
  - Title row: flex, align-items baseline, justify-content space-between, gap 12.
    Site name 21px / 700 / -0.5px `#091540` on the left; address 15px / 500 `#4a5578`
    flush right, text-align right.
  - Time panel: background `#eef3fe`, radius 10, padding 14px 16px, flex space-between,
    align-items baseline, margin-bottom 16px.
    Left: day kicker 12px / 700, letter-spacing 0.9px, uppercase, `#4a5578`, margin-bottom 3px;
    below it the span 20px / 800 / -0.5px `#091540`.
    Right: duration 15px / 700 `#1b2cc1`, nowrap.
  - Action row: flex, gap 10.
    "Acceptera" — flex 2, height 54, radius 10, background `#1b2cc1`, text `#ffffff`,
    17px / 700 / -0.2px, hover `#12206b`, pressed `scale(.985)`.
    "Neka" — flex 1, height 54, radius 10, background `#e7edfb`, text `#12206b`,
    17px / 600 / -0.2px, hover `#dbe4f9`, pressed `scale(.985)`.
- Queue empty state: background `#e7edfb`, radius 14, padding 22px, centered,
  15px / 500 `#4a5578`, text "Inga pass att svara på."

## Interactions & behavior
- **Tap primary button** → toggles clocked-in state. Label swaps Stämpla Ut ⇄ Stämpla In,
  fill swaps `#091540` ⇄ accent, status dot swaps pulsing blue ⇄ flat `#8b98c4`.
  In production this posts a clock event; show a pending state while it is in flight and
  roll back on failure (the prototype toggles optimistically with no network).
- **Acceptera / Neka** → both advance to the next offer in the queue and decrement the
  remaining count by 1 (floor 0). Accept and deny must hit different endpoints in
  production; only the local queue behavior is shared.
- When the count reaches 0 the offer card is replaced by the "Inga pass att svara på."
  empty state and the "N till" count disappears.
- **Rows** "Mina Pass" / "Arbetsdagar" navigate to those screens (not designed here).
- Press feedback everywhere: `transform: scale(.985)`, ~110–120ms.
  Hover tints are one step of the blue ramp. Focus: 2px `#091540` ring, 2px offset —
  never the browser default.
- Reduced motion: drop the dot pulse and the press scale.

## State
| State | Type | Initial | Notes |
| --- | --- | --- | --- |
| `clockedIn` | boolean | `true` | Server truth in production; drives label, fill, dot |
| `pendingCount` | int | `29` | Offers left to answer; shown as "N till" |
| `offerIndex` | int | `0` | Position in the offer queue |
| `showMap` | boolean | `true` | Prototype flag; production always shows the map |
| `primaryStyle` | 'filled' \| 'outlined' | 'filled' | Prototype variant flag |
| `accent` | color | `#1b2cc1` | Prototype theming flag |

Data per offer: `{ site, address, day, time, hours }` — e.g.
`{ site: 'test2', address: 'flintyxegatan 9', day: 'Tisdag 8 sep', time: '07:00–14:00', hours: '6,5 h' }`.
Note: hours are entered by a human and are not derived from the span (unpaid lunch), so
never compute `hours` from `time` on the client.

## Design tokens
**Color**
| Token | Hex | Use |
| --- | --- | --- |
| ink | `#091540` | Primary text, primary fill, icon strokes |
| ink-hover | `#12206b` | Primary fill hover, "Neka" label |
| accent | `#1b2cc1` | Live dot, counts, duration, "Acceptera" fill |
| accent-soft | `#7692ff` | Non-text marks only (fails text contrast) |
| accent-pale | `#abd2fa` | Separator dot, tint marks |
| text-secondary | `#4a5578` | Secondary copy, section labels, kickers |
| chevron | `#8b98c4` | Chevrons, inactive dot |
| ground | `#f3f6fd` | App background |
| surface | `#ffffff` | Cards |
| panel | `#e7edfb` | Empty states, map ground, "Neka" |
| panel-2 | `#eef3fe` | Inset time panel |
| row-hover | `#f6f9ff` | List row hover |
| icon-hover / pressed | `#f0f5ff` / `#dbe4f9` | Icon button states |
| hairline | `#e3eafb` | Row divider |

**Spacing** 2, 4, 6, 8, 10, 14, 16, 18, 20, 22, 26, 40 px. Gutter 16. Card padding 20.
Divider inset 18. Block gaps 14 / 26.

**Type** (Inter, or the codebase's UI font; tabular figures for numerals)
34/800/-1.4 · 23/800/-0.5 · 21/700/-0.5 · 20/800/-0.5 · 17/700/-0.2 · 17/600/-0.2 ·
15/700 · 15/600 · 15/500 · 12/700/+1 uppercase (section label) · 12/700/+0.9 uppercase (kicker).

**Radius** 9 (map) · 10 (buttons, inset panel) · 11 (icon buttons) · 14 (groups, empty states) ·
15 (offer card) · 16 (hero card) · 50% (dots).

**Shadow**
- flat: `0 1px 3px rgba(9,21,64,.08)`
- group: `0 4px 18px rgba(9,21,64,.07), 0 1px 2px rgba(9,21,64,.04)`
- hero: `0 8px 28px rgba(9,21,64,.09), 0 1px 2px rgba(9,21,64,.05)`
- offer: `0 10px 30px rgba(9,21,64,.10), 0 1px 2px rgba(9,21,64,.05)`
- action: `0 6px 18px rgba(9,21,64,.26)`
- stack slab: `0 6px 16px rgba(9,21,64,.06)`

**Tap targets** 44 (icon buttons) · 54 (accept/deny) · 60 (list rows) · 66 (primary action).
Nothing below 44.

## Accessibility
- All body copy ≥ 15px; secondary text `#4a5578` on white ≈ 7:1 and on `#e7edfb` ≈ 6:1.
- `#7692ff` and `#abd2fa` are for marks and fills only — never text.
- The status dot needs a text alternative in production (e.g. accessibility label
  "Instämplad sedan 07:00") since the visible label was removed by design.
- Focus ring: 2px `#091540`, offset 2px.

## Assets
No image or icon assets ship with this design. All icons are inline SVG paths
(hamburger, person, chevron) documented above; substitute the codebase's icon set at
the same stroke weight (~2px, round caps). The map panel is a placeholder for the real
map view. Fonts: the prototype loads Inter/Figtree from Google Fonts — use the app's
existing UI font.

## Files
- `Arbetare Startsida.dc.html` — the designed screen (markup + logic + tweak props).
- `image-slot.js` — helper that powers the drop-in map placeholder in the prototype only. Not needed in production.
- `tokens/` — the light-blue token set (CSS custom properties) if you want the values as code.
- `styles.css` — imports the token files.

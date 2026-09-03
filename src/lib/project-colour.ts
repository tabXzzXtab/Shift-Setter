/**
 * A colour per project, for the shift calendar.
 *
 * This is the one place colour is allowed. Everywhere else is black and white
 * because styling before function is noise -- here the colour IS the function:
 * it is what lets a leader see at a glance that Tuesday is two different sites.
 *
 * A fixed palette rather than a hashed hue. Hashing gives you neighbouring
 * greens sooner or later, and two projects that look alike on a calendar is
 * precisely the failure this is meant to prevent.
 *
 * Assignment is by the project's position in a stable sorted list, so a project
 * keeps its colour between visits. With more projects than colours the palette
 * wraps -- at which point the label on the bar is what tells them apart, which
 * is why every run of days carries one.
 */
const PALETTE = [
  "#1f77b4", // blue
  "#d62728", // red
  "#2ca02c", // green
  "#9467bd", // purple
  "#e07b00", // orange
  "#8c564b", // brown
  "#c934a0", // magenta
  "#0f8f96", // teal
] as const;

export function projectColour(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

/**
 * Black or white text, whichever the eye can actually read on that colour.
 * Relative luminance per WCAG, so an orange gets black and a blue gets white
 * rather than both getting whatever looked fine on one screen.
 */
export function readableInk(hex: string): "#000000" | "#ffffff" {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#000000" : "#ffffff";
}

/** Stable index for a project id, given the sorted list of ids on screen. */
export function colourIndex(projectIds: string[], id: string): number {
  return Math.max(0, [...projectIds].sort().indexOf(id));
}

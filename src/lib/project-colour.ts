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

/** Stable index for a project id, given the sorted list of ids on screen. */
export function colourIndex(projectIds: string[], id: string): number {
  return Math.max(0, [...projectIds].sort().indexOf(id));
}

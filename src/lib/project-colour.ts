/**
 * The handoff's project-chip palette, and a project's place in it.
 *
 * Colour carries meaning on the calendar: it is what lets a leader see at a
 * glance that Tuesday is two different sites. A FIXED palette rather than a
 * hashed hue -- hashing gives you neighbouring greens sooner or later, and two
 * projects that look alike on a calendar is precisely the failure this is meant
 * to prevent.
 *
 * THESE EIGHT ARE ALSO THE EIGHT `personal_event_colour_in_palette` PERMITS.
 * The Personlig calendar's swatch picker offers this list and nothing else, so
 * a colour the check constraint would reject cannot be chosen in the first
 * place. If the list here and the list in the constraint ever diverge, the
 * picker starts offering a value the database refuses -- keep them together.
 *
 * Assignment is by the project's position in a stable sorted list, so a project
 * keeps its colour between visits. With more projects than colours the palette
 * wraps -- at which point the legend under the grid is what tells them apart,
 * which is why the calendar always carries one.
 */
export const CHIP_PALETTE = [
  "#1b2cc1", // accent blue
  "#0f6f7a", // teal
  "#6c3fc5", // violet
  "#1f7a3d", // green
  "#8a5300", // amber
  "#8e1d15", // red
  "#0a5ea8", // steel blue
  "#7a3f8f", // plum
] as const;

export function projectColour(index: number): string {
  return CHIP_PALETTE[index % CHIP_PALETTE.length]!;
}

/** Stable index for a project id, given the sorted list of ids on screen. */
export function colourIndex(projectIds: string[], id: string): number {
  return Math.max(0, [...projectIds].sort().indexOf(id));
}

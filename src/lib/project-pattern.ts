/**
 * Telling projects apart without colour.
 *
 * The shift calendar is the one place colour is allowed, because there it
 * carries meaning for a leader reading a whole month of sites at a glance.
 * A worker's own calendar is not that screen: it is theirs, it usually holds
 * one or two projects, and the rule everywhere else is black and white.
 *
 * So the difference is fill, not hue. Solid, two diagonals, horizontal bars,
 * dots, then a grey — six that stay apart from each other in a 40px cell on a
 * phone, and survive being photocopied, which a hue does not.
 *
 * A fixed list, indexed by position, for the same reason the colour palette is
 * fixed rather than hashed: hashing eventually puts two neighbouring patterns
 * side by side, and two sites that look alike is the failure the distinction
 * exists to prevent.
 */
export const PATTERNS: string[] = [
  "#000",
  "repeating-linear-gradient(45deg,#000 0 3px,#fff 3px 8px)",
  "repeating-linear-gradient(-45deg,#000 0 3px,#fff 3px 8px)",
  "repeating-linear-gradient(0deg,#000 0 3px,#fff 3px 9px)",
  "radial-gradient(#000 42%,#fff 43%) 0 0/8px 8px",
  "#9a9a9a",
];

/**
 * Which fill a project gets: its position among the projects on screen, so the
 * first is always solid and the set is stable for as long as the list is.
 */
export function patternIndex(projectIds: string[], id: string): number {
  const i = projectIds.indexOf(id);
  return i < 0 ? 0 : i % PATTERNS.length;
}

export const projectPattern = (i: number): string => PATTERNS[i % PATTERNS.length]!;

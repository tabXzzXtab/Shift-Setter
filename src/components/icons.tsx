/**
 * Drawn, not imported.
 *
 * A pin needs no icon font, and a font would be one more thing to load before
 * a phone on a building site can see its buttons. `currentColor`, so it takes
 * the colour of whatever it sits in.
 *
 * The hamburger, the profile head and the plus used to live here too. They are
 * drawn inline now, at the exact sizes and stroke widths the handoff gives
 * them -- 20x14 at 2.2, 20x20 at 2, 15x15 at 2.4 -- which a shared 24x24 icon
 * could only approximate.
 */

export const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden focusable="false">
    <g stroke="currentColor" strokeWidth="2.2" fill="none">
      <path d="M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.6" />
    </g>
  </svg>
);

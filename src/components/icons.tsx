/**
 * Drawn, not imported.
 *
 * Three lines and a head and shoulders need no icon font, and a font would be
 * one more thing to load before a phone on a building site can see its
 * buttons. `currentColor` throughout, so an icon inside a black button is
 * white without anything being told twice.
 */

export const Hamburger = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden focusable="false">
    <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </g>
  </svg>
);

export const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden focusable="false">
    <g stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </g>
  </svg>
);

export const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden focusable="false">
    <g stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </g>
  </svg>
);

export const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden focusable="false">
    <g stroke="currentColor" strokeWidth="2.2" fill="none">
      <path d="M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.6" />
    </g>
  </svg>
);

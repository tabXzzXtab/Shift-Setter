import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell around app.bellaserviceab.se.
 *
 * THE SHELL LOADS THE LIVE SITE, it does not ship the build. `server.url`
 * overrides `webDir` at runtime: the WebView navigates to the origin below and
 * the contents of `out/` are never read on device. That is what makes a release
 * a deploy rather than a store submission -- the web app updates and every
 * installed copy updates with it, without review.
 *
 * It is also what the App Store has the most to say about. See the note in
 * README/handoff on Guideline 4.2: a shell whose only content is a remote
 * website is the shape Apple rejects, and the way out is native capability the
 * browser cannot offer, not a better description.
 *
 * `webDir` stays pointed at `out/` because the CLI requires it and because it
 * is the correct answer the day `server.url` comes off -- `npm run build`
 * writes the static export there, so a bundled build needs no other change.
 *
 * NO CLEARTEXT. The origin is HTTPS and nothing on device may fall back to
 * plain HTTP: the browser holds the auth token and talks to PostgREST directly,
 * so the transport is the only thing between that token and the network.
 * Android would otherwise permit cleartext to arbitrary hosts in debug builds.
 */
const config: CapacitorConfig = {
  appId: 'se.bellaserviceab.byggkoll',
  appName: 'ByggKoll',
  webDir: 'out',
  server: {
    url: 'https://app.bellaserviceab.se',
    cleartext: false,
  },
};

export default config;

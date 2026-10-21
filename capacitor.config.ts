import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell that ships the bundled static export.
 *
 * `server.url` has been removed. The WebView now serves from `webDir` (out/)
 * instead of the live site, which is required for App Store submission.
 *
 * Guideline 4.2 note: a shell whose only content is a remote website is what
 * Apple rejects. With server.url gone the app ships the full static bundle and
 * uses native capabilities (push notifications, geofence) the browser cannot
 * offer — that is the correct answer.
 *
 * NO CLEARTEXT. All traffic to Supabase PostgREST is HTTPS only. The auth
 * token lives in the WebView and the transport is the only thing protecting it.
 */
const config: CapacitorConfig = { 
  appId: 'se.bellaserviceab.UrKoll',
  appName: 'UrKoll',
  webDir: 'out',
};

export default config;

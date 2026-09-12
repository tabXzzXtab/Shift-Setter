import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/lib/supabase/auth";
import { AccountProvider } from "@/lib/account";
import "./globals.css";

/**
 * Inter, self-hosted, as a VARIABLE rather than a body font.
 *
 * The arbetare startsida's design handoff calls for it. Setting it on <body>
 * would re-font every other screen in the app as a side effect of one redesign,
 * so it is exposed as --font-inter and applied by the screen that asked for it.
 * next/font fetches at build time and serves the file from our own origin, so
 * there is no request to Google from a phone on a building site.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Icon and manifest URLs are absolute from the root of our own domain.
 *
 * They used to carry a "/Shift-Setter" prefix by hand, because Next does not
 * prefix basePath onto metadata.icons or metadata.manifest -- it does that for
 * file-based conventions only. With the app on app.bellaserviceab.se there is
 * no prefix to carry, and the hand-written one would now be the thing that
 * 404s every icon.
 */
const BASE = "";

export const metadata: Metadata = {
  title: "ByggKoll",
  description: "Skiftplanering och Arbetsdagbok",
  applicationName: "ByggKoll",
  manifest: `${BASE}/manifest.json`,
  icons: {
    icon: [
      { url: `${BASE}/favicon.ico`, sizes: "32x32 16x16", type: "image/x-icon" },
      { url: `${BASE}/favicon-32.png`, sizes: "32x32", type: "image/png" },
      { url: `${BASE}/favicon-16.png`, sizes: "16x16", type: "image/png" },
      { url: `${BASE}/icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    // iOS ignores transparency, so this one is flattened onto the app's ground
    // rather than left to be painted black behind.
    apple: [{ url: `${BASE}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
};

// Mobile first: the phone is the design target, so the viewport is declared
// rather than inherited, and zoom is left alone -- pinching a form is a real
// need on a site, and disabling it is an accessibility failure.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The colour the phone paints its chrome with when the app is installed.
  // Next wants this on viewport rather than metadata since 14.
  themeColor: "#091540",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sv" className={inter.variable}>
      <body className="bg-white text-black antialiased">
        <AuthProvider>
          <AccountProvider>{children}</AccountProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

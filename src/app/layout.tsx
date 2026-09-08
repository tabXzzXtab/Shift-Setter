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

export const metadata: Metadata = {
  title: "Shift Setter",
  description: "Skiftplanering och Arbetsdagbok",
};

// Mobile first: the phone is the design target, so the viewport is declared
// rather than inherited, and zoom is left alone -- pinching a form is a real
// need on a site, and disabling it is an accessibility failure.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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

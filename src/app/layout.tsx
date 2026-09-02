import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/supabase/auth";
import { AccountProvider } from "@/lib/account";
import "./globals.css";

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
    <html lang="sv">
      <body className="bg-white text-black antialiased">
        <AuthProvider>
          <AccountProvider>{children}</AccountProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

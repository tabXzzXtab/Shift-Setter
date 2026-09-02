import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shift Setter",
  description: "Skiftplanering och Arbetsdagbok",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sv">
      <body className="bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}

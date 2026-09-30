"use client";

import { useRouter } from "next/navigation";
import { CompanyForm } from "@/components/company-form";

/**
 * Ställ in ditt företag -- what a company's admin meets first, while the
 * company has no address, kontaktperson or telefon (src/lib/company-setup.ts
 * decides, from the database). The same form as Företaget. Saving goes on to
 * the start page, where the tour -- waiting until now -- begins.
 */
export default function StallInPage() {
  const router = useRouter();
  return <CompanyForm mode="setup" onDone={() => router.replace("/")} />;
}

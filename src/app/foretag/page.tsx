"use client";

import { CompanyForm } from "@/components/company-form";

/**
 * Företaget -- the company's own details, after the day it was set up. The
 * form, and its account of why each field is there, is shared with the
 * first-login setup screen (/stall-in) in src/components/company-form.tsx.
 */
export default function ForetagPage() {
  return <CompanyForm mode="settings" />;
}

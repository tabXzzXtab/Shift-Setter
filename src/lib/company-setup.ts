import type { Role } from "@/lib/account";
import { getSupabase } from "@/lib/supabase/client";

/** Where an admin sets the company up, before anything else. */
export const SETUP_ROUTE = "/stall-in";

/**
 * Whether this account has to set its company up before anything else:
 * "Ställ in ditt företag", then the tour.
 *
 * ASKED OF THE DATABASE, not remembered on the device. Invariant 7: the
 * company's own fields -- address, kontaktperson, telefon -- are captured at
 * onboarding, before the Arbetsdagbok can need them. So the question is not
 * "is this the first login" but "does the company have them", which is true
 * on every device at once and never true for a company that already has
 * them (Bella's row was seeded complete).
 *
 * Only a company's own admin is asked: the policies let nobody else write
 * the row. Not the operator, acting inside a client or not -- looking round a
 * customer's tenancy must not sit them down to fill in its address.
 *
 * FAILS OPEN. Any read that does not come back says "no setup needed": a
 * screen that cannot be left, reached because of a network error, is worse
 * than a document that later refuses to generate and says why.
 */
export async function companySetupNeeded(accountId: string, role: Role): Promise<boolean> {
  if (role !== "admin") return false;
  try {
    const sb = getSupabase();
    const [{ data: me }, { data: acting }, { data: tenants }] = await Promise.all([
      sb.from("account").select("super_admin").eq("id", accountId).maybeSingle(),
      sb.rpc("acting_tenant"),
      sb.from("tenant").select("id"),
    ]);
    if (me?.super_admin || (Array.isArray(acting) && acting.length > 0)) return false;
    if (!tenants || tenants.length !== 1) return false;
    const { data: b, error } = await sb.from("tenant_branding")
      .select("address, contact_name, phone").eq("tenant_id", tenants[0]!.id).maybeSingle();
    if (error) return false;
    return !(b?.address && b.contact_name && b.phone);
  } catch {
    return false;
  }
}

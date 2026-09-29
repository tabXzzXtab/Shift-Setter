import { getSupabase } from "@/lib/supabase/client";
import type { DocSender } from "./arbetsdagbok";

/**
 * The company that issues a project's Arbetsdagbok: the PROJECT's tenancy,
 * which is the one filing it -- including when the operator files it from
 * inside a client.
 *
 * Name and org.nr from public.tenant, the rest from public.tenant_branding,
 * and the logo downloaded from the private branding bucket into bytes, which
 * is what the PDF embeds and what the preview shows through an object URL.
 * A logo that cannot be read is left out rather than failing the document:
 * the company name prints in its place, the same as for a company with none.
 *
 * Called after the database has accepted the filing, and the database refuses
 * a filing without address, contact and phone -- so a missing row here is not
 * expected. It is still said in Swedish rather than assumed away.
 */
export async function loadSender(tenantId: string): Promise<DocSender> {
  const sb = getSupabase();
  const [{ data: t, error: tErr }, { data: b, error: bErr }] = await Promise.all([
    sb.from("tenant").select("name, org_nr").eq("id", tenantId).maybeSingle(),
    sb.from("tenant_branding")
      .select("logo_path, address, contact_name, phone, bankgiro, momsreg_nr, f_skatt")
      .eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (tErr || bErr) throw tErr ?? bErr;
  if (!t || !b?.address || !b.contact_name || !b.phone) {
    throw new Error("Företagets egna uppgifter saknas: adress, kontaktperson och telefon.");
  }

  let logo: DocSender["logo"] = null;
  if (b.logo_path) {
    const { data: blob } = await sb.storage.from("branding").download(b.logo_path);
    if (blob) {
      logo = {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        type: b.logo_path.endsWith(".jpg") ? "jpg" : "png",
        url: URL.createObjectURL(blob),
      };
    }
  }

  return {
    name: t.name,
    orgnr: t.org_nr,
    address: b.address,
    contact: b.contact_name,
    phone: b.phone,
    bankgiro: b.bankgiro,
    momsreg: b.momsreg_nr,
    fSkatt: b.f_skatt,
    logo,
    logoFailed: Boolean(b.logo_path) && !logo,
  };
}

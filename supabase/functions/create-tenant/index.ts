/**
 * create-tenant -- onboarding a whole new company, which is the one write that
 * lands in a tenancy that is not the caller's.
 *
 * create-account says so in its own header and declines the job: it puts the
 * new account in the tenant of the admin who asked, because a client's admin
 * must never be able to place somebody inside another client's company. That
 * is right for staffing and useless here, where there is no admin yet and no
 * tenancy to join. A brand-new tenant has nobody who could authorise its first
 * account, exactly as bootstrap-admin.mjs describes for the founding one.
 *
 * So this function makes all four rows: tenant, auth identity, account, worker.
 *
 * THE PIN IS THE CREDENTIAL, AND HERE IT FINALLY MEANS SOMETHING.
 *
 * On the onboarding page the gate is decorative -- stage two is client state,
 * and anyone willing to open devtools is past it. That cost nothing while the
 * screens behind it did nothing. This endpoint mints a company and an admin
 * account, so a caller who reached it without the code would be creating real
 * tenancies from a URL. The code is therefore checked HERE, server side,
 * against the same secret verify-pin reads -- not inferred from the fact that
 * a browser showed somebody the form.
 *
 * AND IT GOES THROUGH THE SAME CEILINGS. note_pin_attempt() is called before
 * anything else, so this endpoint cannot be used as an unmetered oracle for
 * the code that verify-pin rate limits. Skipping it here would have left the
 * limiter guarding the cheap door while the expensive one stood open.
 *
 * verify-pin still exists and is still called first by the page. It is the
 * fast "is this code right" so somebody who mistyped learns it at the gate
 * rather than after filling in a form. It is not what protects this.
 *
 * Deployed with --no-verify-jwt: the salesperson may hold no account in this
 * app at all, which is the premise of the whole flow.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/**
 * The three the onboarding screen offers -- and 'owner' is deliberately not
 * among them. That is Korperation's own tenancy type, the one whose accounts
 * can be made super admins and read every customer's data. A public endpoint
 * that could mint one would hand the whole product over; the enum has four
 * values and this list has three for that reason alone.
 */
const ROUTES = ["demo", "sold", "gift"] as const;
type Route = (typeof ROUTES)[number];

/** The demo's length, and the only reason tenant.expires_at exists. */
const DEMO_DAYS = 21;

/** Swedish organisationsnummer, the form every Swedish company has. */
const ORG_NR = /^\d{6}-\d{4}$/;

/** Compared byte by byte to the end, so the time taken does not narrow it. */
function sameCode(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** The platform's entry, not the caller's -- see the rate_limit migration. */
function callerKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // ---- 1. the ceilings, before anything is read or written ----------------
  const { data: verdict, error: rlErr } = await admin.rpc("note_pin_attempt", {
    p_ip: callerKey(req),
  });
  if (rlErr) {
    // FAIL CLOSED. A limiter that cannot count is not a reason to stop
    // limiting, and this endpoint is far too expensive to let through on a
    // database wobble.
    console.error("create-tenant: note_pin_attempt failed:", rlErr.message);
    return json({ error: "too many attempts" }, 429);
  }
  if (verdict !== "ok") {
    // The English is the KEY, not the copy -- src/lib/fel.ts holds the one
    // Swedish sentence, shared with the gate so the two cannot drift.
    return json({ error: "too many attempts", ceiling: verdict }, 429);
  }

  // ---- 2. the code --------------------------------------------------------
  const expected = Deno.env.get("ONBOARDING_PIN") ?? "";
  if (!expected) {
    console.error("create-tenant: ONBOARDING_PIN is not set; refusing everything");
    return json({ error: "Fel kod." }, 403);
  }

  let body: {
    pin?: unknown;
    route?: unknown;
    company?: { name?: unknown; org_nr?: unknown; invoice_email?: unknown };
    admin?: { name?: unknown; email?: unknown; password?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ogiltig begäran." }, 400);
  }

  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!pin || !sameCode(pin, expected)) return json({ error: "Fel kod." }, 403);

  // ---- 3. what was asked for ---------------------------------------------
  const route = String(body.route ?? "") as Route;
  if (!ROUTES.includes(route)) return json({ error: "Okänd typ av konto." }, 400);

  const cName = String(body.company?.name ?? "").trim();
  const orgNr = String(body.company?.org_nr ?? "").trim();
  const invoice = String(body.company?.invoice_email ?? "").trim().toLowerCase();
  const aName = String(body.admin?.name ?? "").trim();
  const aEmail = String(body.admin?.email ?? "").trim().toLowerCase();
  const aPass = typeof body.admin?.password === "string" ? body.admin.password : "";

  if (!cName) return json({ error: "Företagets namn saknas." }, 400);
  if (!ORG_NR.test(orgNr)) {
    return json({ error: "Organisationsnumret ska skrivas som 556677-8899." }, 400);
  }
  // Required only where somebody is going to be invoiced. A demo and a gift
  // have nobody to send a bill to, and demanding an address for one would be
  // asking the salesperson to invent it.
  if (route === "sold" && !invoice) {
    return json({ error: "Fakturamejl saknas." }, 400);
  }
  if (invoice && !invoice.includes("@")) {
    return json({ error: "Fakturamejlen ser inte ut som en e-postadress." }, 400);
  }
  if (!aName) return json({ error: "Administratörens namn saknas." }, 400);
  if (!aEmail.includes("@")) return json({ error: "E-postadressen ser inte riktig ut." }, 400);
  // The same bounds create-account enforces, because the same person reads the
  // password off the same kind of card afterwards.
  if (aPass.length < 6 || aPass.length > 20) {
    return json({ error: "Lösenordet måste vara 6-20 tecken." }, 400);
  }

  // ---- 4. is this company already here? -----------------------------------
  //
  // A CHECK IN THE FUNCTION, WHICH IS THE WEAKER KIND. public.tenant has no
  // unique index on org_nr, so this races: two requests in the same second
  // both see nothing and both insert. It is worth having anyway -- it turns
  // the ordinary case, somebody onboarding a company that is already a
  // customer, into a sentence instead of a duplicate. The real fix is a unique
  // constraint, which is a migration and is flagged rather than smuggled in
  // here.
  const { data: dupe } = await admin
    .from("tenant")
    .select("id, name")
    .eq("org_nr", orgNr)
    .maybeSingle();
  if (dupe) {
    return json({ error: `${dupe.name} finns redan med det organisationsnumret.` }, 409);
  }

  // ---- 5. the identity first ----------------------------------------------
  //
  // ORDER IS DELIBERATE. The likeliest failure in the whole chain is an email
  // that is already registered, and it is only discoverable by trying. Doing
  // it first means that failure writes nothing at all and needs no undo; a
  // tenant created first would have to be swept up again every time somebody
  // reused an address.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: aEmail,
    password: aPass,
    email_confirm: true, // the email is an identifier, not a guaranteed inbox
    user_metadata: { name: aName },
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "Kunde inte skapa kontot.";
    return json({ error: /already/i.test(msg) ? "E-posten används redan." : msg }, 400);
  }
  const uid = created.user.id;

  /**
   * Undo, in reverse. There is no transaction across GoTrue and PostgREST, so
   * the chain is unwound by hand and every step that can fail says what to
   * take back. A half-made company is worse than none: it would sit in /super
   * looking real, with nobody able to sign into it.
   */
  const undo = async (reason: string, status: number, tenantId?: string) => {
    if (tenantId) {
      await admin.from("worker").delete().eq("account_id", uid);
      await admin.from("account").delete().eq("id", uid);
      await admin.from("tenant").delete().eq("id", tenantId);
    }
    await admin.auth.admin.deleteUser(uid);
    return json({ error: reason }, status);
  };

  // ---- 6. the company ------------------------------------------------------
  //
  // A demo MUST carry an expiry -- public.tenant has a CHECK saying so, and it
  // is the whole reason the column exists. The other two have no end date, so
  // theirs is null rather than a date far away that somebody would later read
  // as real.
  const expires_at =
    route === "demo"
      ? new Date(Date.now() + DEMO_DAYS * 86_400_000).toISOString()
      : null;

  const { data: tenant, error: tErr } = await admin
    .from("tenant")
    .insert({
      name: cName,
      org_nr: orgNr,
      account_type: route,
      expires_at,
      invoice_email: invoice || null,
    })
    .select("id")
    .single();
  if (tErr || !tenant) return undo(tErr?.message ?? "Kunde inte skapa företaget.", 400);

  // ---- 7. the first admin --------------------------------------------------
  //
  // tenant_id IS SENT, for the reason create-account gives at length: a
  // service-role connection has no auth.uid(), so the column default
  // app.current_tenant_id() resolves to NULL and the insert fails its own
  // not-null constraint. Here it is the tenant this request just made.
  //
  // created_by is null. Every other account in the app records the admin who
  // made it; this one has no admin behind it by definition, and a fabricated
  // id would be worse than an honest absence.
  //
  // super_admin is left at its default false. account_super_admin_insert_guard
  // only raises when the flag is true, so this passes -- and it must stay that
  // way: super admin is Korperation's, and a customer's founding admin
  // acquiring it from a public endpoint is the one outcome this whole file
  // must not produce.
  const { error: acctErr } = await admin.from("account").insert({
    id: uid,
    role: "admin",
    active: true,
    created_by: null,
    tenant_id: tenant.id,
  });
  if (acctErr) return undo(acctErr.message, 400, tenant.id);

  // The composite key worker_tenant_matches_account refuses any other tenant:
  // a worker row whose tenant disagrees with its account's cannot exist.
  const { data: worker, error: wErr } = await admin
    .from("worker")
    .insert({ account_id: uid, name: aName, email: aEmail, tenant_id: tenant.id })
    .select("id")
    .single();
  if (wErr || !worker) return undo(wErr?.message ?? "Kunde inte skapa arbetaren.", 400, tenant.id);

  // The password is NOT echoed back. The client already has it -- it chose it,
  // the same way create-account works -- and a credential that has been
  // written into a response body is a credential in one more log.
  return json({
    tenant_id: tenant.id,
    account_id: uid,
    worker_id: worker.id,
    name: cName,
    org_nr: orgNr,
    account_type: route,
    expires_at,
    admin_email: aEmail,
  });
});

/**
 * update-account -- changing the name and email on someone else's identity.
 *
 * Everything else the Inställningar page does goes straight to PostgREST: the
 * role and the active flag are ordinary columns on public.account, guarded by
 * the admin policy and by app.tg_last_admin_guard(), and a database that
 * enforces its own rules is worth more than a function that repeats them.
 *
 * The email is different. It is the login, and the login lives in auth.users,
 * which is not an exposed schema and never will be. Writing it needs the
 * service-role key, which can never ship in a static bundle (spec Section 6).
 * So this is the same shape as create-account and for the same reason.
 *
 * It writes BOTH sides. worker.email is what the app reads and auth.users.email
 * is what the person signs in with; changing one and not the other produces an
 * account whose displayed address is not the one that works, which is worse
 * than refusing the change.
 *
 * The caller's role is read from the DATABASE, not from their token, so a
 * demoted admin loses this on their next call rather than at token expiry.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Inte inloggad." }, 401);

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) return json({ error: "Inte inloggad." }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: acct } = await admin
    .from("account")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!acct || !acct.active || acct.role !== "admin") {
    return json({ error: "Endast administratören kan ändra ett konto." }, 403);
  }

  let body: { account_id?: string; name?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ogiltig begäran." }, 400);
  }

  const target = (body.account_id ?? "").trim();
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();

  if (!target) return json({ error: "Konto saknas." }, 400);
  if (!name) return json({ error: "Namn saknas." }, 400);
  if (!email) return json({ error: "E-post saknas." }, 400);

  const { data: exists } = await admin
    .from("account").select("id").eq("id", target).maybeSingle();
  if (!exists) return json({ error: "Kontot finns inte." }, 404);

  // The identity first. If this fails nothing else has moved yet, so there is
  // no half-applied change to unpick.
  const { error: authErr } = await admin.auth.admin.updateUserById(target, {
    email,
    email_confirm: true,   // the email is an identifier, not a guaranteed inbox
    user_metadata: { name },
  });
  if (authErr) {
    const msg = authErr.message ?? "Kunde inte ändra kontot.";
    return json({ error: /already|registered/i.test(msg) ? "E-posten används redan." : msg }, 400);
  }

  // The worker record, where one exists. The founding admin has none, and that
  // is not an error -- their name now lives in the auth metadata written above.
  const { error: wErr } = await admin
    .from("worker").update({ name, email }).eq("account_id", target);
  if (wErr) return json({ error: wErr.message }, 400);

  return json({ account_id: target, name, email });
});

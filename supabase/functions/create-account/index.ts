/**
 * create-account -- the one write that cannot happen from the browser.
 *
 * Creating an auth user needs the service-role key, which can never ship in a
 * static bundle (spec Section 6). So worker creation runs here instead, and
 * this is the only path: "Creating a worker creates their account. There is no
 * separate account-creation flow."
 *
 * The caller's role is read from the DATABASE, not from their token, so a
 * demoted admin loses this on their next call rather than at token expiry.
 *
 * The password arrives from the client rather than being generated here, and
 * that is deliberate: the interface must copy the credential block to the
 * clipboard BEFORE the account exists ("Kopiera Inloggning" gates "Tillverka
 * Arbetare"). An account whose credentials nobody holds is an account nobody
 * can use, and the worker has no way to ask for them.
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

  // Who is calling: resolved from their own token.
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) return json({ error: "Inte inloggad." }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Role from the database, never the JWT.
  const { data: acct } = await admin
    .from("account")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!acct || !acct.active || acct.role !== "admin") {
    return json({ error: "Endast administratören kan skapa konton." }, 403);
  }

  let body: { name?: string; email?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ogiltig begäran." }, 400);
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role === "arbetsledare" ? "arbetsledare" : "arbetare";

  if (!name) return json({ error: "Namn saknas." }, 400);
  if (!email) return json({ error: "E-post saknas." }, 400);
  // Spec Section 3: 6 to 20 characters, typeable on a phone and a desktop.
  if (password.length < 6 || password.length > 20) {
    return json({ error: "Lösenordet måste vara 6-20 tecken." }, 400);
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // the email is an identifier, not a guaranteed inbox
    user_metadata: { name },
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "Kunde inte skapa kontot.";
    return json({ error: /already/i.test(msg) ? "E-posten används redan." : msg }, 400);
  }

  const uid = created.user.id;

  // From here on, any failure must not leave a half-made identity behind.
  const undo = async (reason: string, status = 400) => {
    await admin.auth.admin.deleteUser(uid);
    return json({ error: reason }, status);
  };

  const { error: acctErr } = await admin
    .from("account")
    .insert({ id: uid, role, active: true, created_by: user.id });
  if (acctErr) return undo(acctErr.message);

  const { data: worker, error: workerErr } = await admin
    .from("worker")
    .insert({ account_id: uid, name, email })
    .select("id")
    .single();
  if (workerErr) {
    await admin.from("account").delete().eq("id", uid);
    return undo(workerErr.message);
  }

  return json({ account_id: uid, worker_id: worker.id, name, email, role });
});

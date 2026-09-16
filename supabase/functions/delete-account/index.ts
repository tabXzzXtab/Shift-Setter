/**
 * delete-account -- taking an account out of the company.
 *
 * The DECISION is not made here. public.delete_account() makes it, inside the
 * database, by asking the foreign keys whether anything still points at the
 * person: an account nothing references is erased outright ('raderat'), and an
 * account with history is shut down with its rows intact ('avstangt'), because
 * invariant 3 wants the hours on a confirmed day to keep the name that
 * confirmed them. Invariant 11 is enforced there too, by the same
 * app.tg_last_admin_guard() that refuses a demotion.
 *
 * So this function is a thin executor for the ONE thing the database cannot
 * reach: auth.users. That table is not an exposed schema and never will be, and
 * writing it needs the service-role key, which can never ship in a static
 * bundle (spec Section 6). Same shape as create-account and update-account, and
 * for the same reason.
 *
 * THE RPC IS CALLED AS THE CALLER, not with the service key. app.is_admin()
 * reads auth.uid(); a service-role call has none, so the function would refuse
 * itself. That is the right way round -- it means the admin test that matters
 * is the one in the database, and the check below only exists to produce a
 * Swedish sentence instead of a Postgres error code.
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

/** A hundred years. Supabase has no "disabled" flag; a ban far enough out is
 *  it. Reversing one is ban_duration: "none", which is the path a future
 *  "återställ konto" would take -- account.deleted_at records that it happened. */
const FOREVER = "876000h";

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
    return json({ error: "Endast administratören kan ta bort ett konto." }, 403);
  }

  let body: { account_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ogiltig begäran." }, 400);
  }

  const target = (body.account_id ?? "").trim();
  if (!target) return json({ error: "Konto saknas." }, 400);

  // The database decides, and writes everything on its own side first: the
  // worker row, the pause cascade that releases every unstarted shift, the
  // removal mark. Nothing below runs if this refuses.
  const { data: mode, error: rpcErr } = await caller
    .rpc("delete_account", { p_account: target });

  if (rpcErr) {
    const m = rpcErr.message ?? "";
    const swedish =
      /last active admin/i.test(m)
        ? "Det här är den sista aktiva administratören och kan inte tas bort."
        : /cannot remove itself/i.test(m)
        ? "Du kan inte ta bort ditt eget konto."
        : /already removed/i.test(m)
        ? "Kontot är redan borttaget."
        : /no such account/i.test(m)
        ? "Kontot finns inte."
        : /only an admin/i.test(m)
        ? "Endast administratören kan ta bort ett konto."
        : "Kontot kunde inte tas bort. Kontakta administratören.";
    return json({ error: swedish }, /only an admin|last active admin/i.test(m) ? 403 : 400);
  }

  // auth.users is the half the database cannot reach. If this fails the person
  // is already locked out either way -- app.current_role() ends in "and
  // a.active", so a removed account resolves to NULL and gotcha 3 turns every
  // helper false -- but their login would still accept a password, so say so
  // rather than reporting a clean success.
  const authErr = mode === "raderat"
    // The account row is already gone; ON DELETE CASCADE has nothing left to do.
    ? (await admin.auth.admin.deleteUser(target)).error
    : (await admin.auth.admin.updateUserById(target, { ban_duration: FOREVER })).error;

  if (authErr) {
    return json({
      mode,
      warning: "Kontot är borttaget ur systemet, men inloggningen kunde inte "
        + "stängas av. Kontakta administratören.",
    });
  }

  return json({ mode });
});

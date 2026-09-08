/**
 * reset-password -- the forgot-password request, made from a signed-out browser.
 *
 * This exists because of one requirement: an admin account cannot use this
 * flow, and the request page must say the same neutral sentence either way.
 * Both halves cannot be honoured in the browser.
 *
 * The page is unauthenticated by definition, and role is unreadable to an
 * anonymous visitor -- account_directory is granted to `authenticated` and
 * filters on `app.is_admin() or a.id = auth.uid()`, and worker's SELECT policy
 * is self-or-admin. So the client cannot tell whether an address belongs to an
 * admin. Giving it a way to find out would be worse than the gap: any
 * anon-readable "is this an admin?" lookup is precisely the enumeration oracle
 * the neutral message exists to prevent. And a check written in the page would
 * be decorative -- see CLAUDE.md, the interface is never the boundary.
 *
 * So the lookup runs here, behind the service-role key, the same route
 * create-account and update-account take and for the same reason.
 *
 * EVERY outcome returns the same body with the same status. Unknown address,
 * admin address, paused account, real worker -- the caller cannot tell them
 * apart, which is the whole point. The only thing that varies is whether a
 * mail is actually sent.
 *
 * Deployed with --no-verify-jwt: the caller is signed out, that is the premise.
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
 * The one response. Deliberately not a function of anything the caller sent.
 */
const NEUTRAL = () => json({ ok: true });

// GoTrue has no get-user-by-email, so the directory is walked. A construction
// company's roster fits in the first page; the bound stops a pathological
// account table from holding the request open forever.
const PER_PAGE = 1000;
const MAX_PAGES = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: { email?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return NEUTRAL();
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return NEUTRAL();

  // Where the mail's link lands. Passed by the page so dev and Pages each get
  // their own origin; Supabase's redirect allow-list is what validates it, so
  // an address that is not on that list sends the user to the site URL instead
  // of wherever a caller asked for.
  const redirectTo =
    typeof body.redirectTo === "string" && /^https?:\/\//.test(body.redirectTo)
      ? body.redirectTo
      : undefined;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // 1. Address -> account id. Not found is not an error here; it is one of the
  //    outcomes that must be indistinguishable from the rest.
  let userId: string | undefined;
  for (let page = 1; page <= MAX_PAGES && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data) break;
    userId = data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id;
    if (data.users.length < PER_PAGE) break;
  }
  if (!userId) return NEUTRAL();

  // 2. Role from the database, never from anything the caller supplied.
  const { data: acct } = await admin
    .from("account")
    .select("role, active")
    .eq("id", userId)
    .maybeSingle();

  // Fail closed on every uncertainty. No account row means no role to check,
  // and a paused account cannot sign in anyway -- neither gets a mail, and
  // neither says so.
  if (!acct || !acct.active) return NEUTRAL();

  // 3. The requirement. An admin's credentials are managed by whoever created
  //    the account; the flow does nothing for them and reports nothing about
  //    them.
  if (acct.role === "admin") return NEUTRAL();

  // 4. A worker or an arbetsledare. Sent with the anon key, so this is the
  //    ordinary password-recovery mail and the link carries an ordinary
  //    recovery token -- the service key never touches the message.
  const sender = createClient(url, anon, { auth: { persistSession: false } });
  await sender.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);

  // Failures are swallowed on purpose: a bounced send that reported itself
  // would tell the caller the address was real and not an admin.
  return NEUTRAL();
});

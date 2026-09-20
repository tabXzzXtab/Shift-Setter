/**
 * verify-pin -- the onboarding gate's one question, answered off the client.
 *
 * The app is a static export and the browser holds nothing secret: a PIN
 * compared in the bundle is a PIN printed in the bundle, readable by anyone
 * who opens the network tab. So the comparison happens here, where the value
 * lives in the function's environment and never leaves it. The answer the
 * browser gets back is one bit.
 *
 * THE BIT IS ALL THIS PROTECTS. A caller who forges `{ valid: true }` in their
 * own devtools reaches the route-selection screen, because that screen is
 * drawn by the client and there is no server to draw it instead -- see
 * CLAUDE.md, every restriction that lives in the interface is decorative. What
 * that screen eventually DOES -- assigning a demo, marking a sale -- has to be
 * gated in the database by RLS, exactly like every other write in this app.
 * This function keeps the code itself out of the bundle; it is not a session
 * and must never be treated as one.
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

/* ---- rate limit: 5 per caller per minute, 40 across everybody ------------ */

/**
 * The count lives in the DATABASE, and the reason is a measurement.
 *
 * This was a Map in module scope. It returns 429 on the sixth attempt when the
 * function is run locally under Deno; on the deployed function it never fired
 * at all -- twelve wrong codes from one caller inside one minute were all
 * answered 200. That memory does not survive between requests on Supabase's
 * edge, so every attempt arrived with an empty window. A local pass proved
 * nothing about production, which is the part worth remembering.
 *
 * app.rate_limit and public.note_pin_attempt() replace it. One call counts the
 * attempt and judges it in the same statement, because read-then-write from
 * here would race: two requests arriving together would each read four and
 * each decide they were the fifth.
 *
 * TWO CEILINGS, AND BOTH BITE. I expected only the global one to: the theory
 * was that x-forwarded-for is the caller's to set, so rotating it would walk
 * around any per-IP limit. Measured against the deployed function, it is not
 * -- 47 requests with 47 different header values all keyed to the same real
 * client address. Supabase's edge prepends the true address, so the FIRST
 * entry is the platform's and the caller's value trails behind it, ignored.
 *
 * Which makes `split(',')[0]` in callerKey() the line the per-IP ceiling rests
 * on. Taking the last entry would hand the bucket back to the caller.
 *
 * The global ceiling is the one that holds whatever the platform does with
 * headers; its price is that a real salesperson is turned away too while an
 * attack is running.
 */

/**
 * Who is asking, as well as this can be known from behind a proxy.
 *
 * THE FIRST ENTRY, and that is the security-relevant part: the platform
 * prepends the real client address, so entry zero is the one the caller could
 * not choose. remoteAddr is no use here -- it is the edge's own address and
 * identical for everybody.
 *
 * A missing header is not a free pass: note_pin_attempt() folds it into one
 * shared bucket rather than letting it through. In practice that bucket stays
 * empty on this platform, which is itself the evidence the header is always
 * present and always the platform's.
 */
function callerKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
}

/** 'ok' | 'ip' | 'global' -- which ceiling stopped it, if any. */
async function noteAttempt(
  admin: ReturnType<typeof createClient>,
  ip: string,
): Promise<string> {
  const { data, error } = await admin.rpc("note_pin_attempt", { p_ip: ip });
  if (error) {
    // FAIL CLOSED. A limiter that cannot count is not a reason to stop
    // limiting -- if the database is unreachable the safe reading is that
    // this attempt does not get through, not that every attempt does.
    console.error("verify-pin: note_pin_attempt failed:", error.message);
    return "global";
  }
  return typeof data === "string" ? data : "ok";
}

/* ---- the comparison ------------------------------------------------------ */

/**
 * Compared byte by byte to the end, so the time taken does not narrow the
 * search. Length is allowed to leak: the code's length is not the secret, and
 * a caller who supplies a different one has already been told nothing.
 */
function sameCode(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // COUNTED BEFORE THE CODE IS EVEN LOOKED AT, and refused before it is
  // compared. A limiter that ran after the comparison would leak the answer it
  // exists to protect: a wrong code and a right one would take different paths
  // through the function.
  const verdict = await noteAttempt(admin, callerKey(req));
  if (verdict !== "ok") {
    // 429 rather than a plain `valid: false`, so the screen can say "wait"
    // instead of "wrong" -- telling somebody their correct code was wrong is
    // how a person concludes the code has changed and goes asking for a new one.
    //
    // The English is the KEY, not the copy. src/lib/fel.ts turns it into the
    // one Swedish sentence both ceilings say; the function does not carry the
    // wording, so it cannot drift from every other refusal in the app.
    return json({ valid: false, error: "too many attempts", ceiling: verdict }, 429);
  }

  // The code, from the environment. FAILS CLOSED: an unset secret is a
  // deployment that is not finished, and the safe reading of "no code
  // configured" is that nothing matches it -- not that anything does.
  const expected = Deno.env.get("ONBOARDING_PIN") ?? "";
  if (!expected) {
    console.error("verify-pin: ONBOARDING_PIN is not set; refusing every attempt");
    return json({ valid: false });
  }

  let body: { pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ valid: false });
  }

  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!pin) return json({ valid: false });

  return json({ valid: sameCode(pin, expected) });
});

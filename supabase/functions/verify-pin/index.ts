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

/* ---- rate limit: 5 attempts per IP per minute ---------------------------- */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

/**
 * The window, per caller, held in the isolate.
 *
 * BEST EFFORT, AND THE LIMITS ARE WORTH STATING PLAINLY. This is process
 * memory: it empties on a cold start, and two isolates serving the same
 * function keep two separate counts, so the real ceiling is 5 per isolate per
 * minute rather than 5 per minute. A durable count would need a table and a
 * migration -- there is no other shared store in this architecture, no cron
 * and no server.
 *
 * It stops a browser loop and a careless script. It does not stop a determined
 * attacker, who can also rotate the header the key is read from (below). A
 * five-digit code is 100k possibilities; treat the limit as friction, not as
 * the thing standing between that code and a guesser.
 */
const hits = new Map<string, number[]>();

/** Bounded so a long-lived isolate cannot accumulate a key per caller seen. */
const MAX_KEYS = 10_000;

function sweep(now: number) {
  if (hits.size < MAX_KEYS) return;
  for (const [key, times] of hits) {
    if (times.every((t) => t <= now - WINDOW_MS)) hits.delete(key);
  }
}

/**
 * Who is asking, as well as this can be known from behind a proxy.
 *
 * x-forwarded-for is what the platform sets and the only per-caller signal
 * available -- remoteAddr is the edge's own address and identical for
 * everybody. It is also a request header, so a caller can prepend a value of
 * their own and land on a fresh bucket every time. That is a real hole and
 * there is no header that closes it from inside a function; it is the second
 * reason the limit above is friction rather than a defence.
 */
function callerKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  return xff.split(",")[0]!.trim() || "unknown";
}

/** True when this caller has already spent the window's attempts. */
function overLimit(key: string): boolean {
  const now = Date.now();
  sweep(now);
  const recent = (hits.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    // Written back pruned, so a caller sitting on the limit does not keep a
    // growing array of timestamps that are all expired but one.
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
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

  if (overLimit(callerKey(req))) {
    // 429 rather than a plain `valid: false`, so the screen can say "wait"
    // instead of "wrong" -- telling somebody their correct code was wrong is
    // how a person concludes the code has changed and goes asking for a new one.
    return json({ valid: false, error: "rate_limited" }, 429);
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

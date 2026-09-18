/**
 * send-push -- the half that wakes the handset.
 *
 * src/lib/push.ts files a device token; this reads it back and rings the
 * phone. A static export has no server and the FCM credential can never ship
 * in the bundle, so the send happens here (CLAUDE.md, spec Section 6).
 *
 * THE CALLER IS A MACHINE, NOT A PERSON. Every other function in this folder
 * resolves a user from their token and reads their role from the database.
 * This one is the opposite: it is called on behalf of the system, and the only
 * credential that may call it is the service-role key. A push is addressed to
 * an account the caller NAMES, so a function that accepted a logged-in user
 * would let any worker put arbitrary text on any other worker's lock screen.
 * There is no role that would make that safe, which is why the check is the
 * key itself rather than a lookup.
 *
 * FCM v1, NOT THE LEGACY ENDPOINT. Google removed the legacy HTTP API and its
 * "server key" in June 2024. v1 authenticates with a service-account JSON and
 * an OAuth2 bearer minted from it, which is why there is a JWT exchange below
 * rather than a header holding a secret.
 *
 * ONE REQUEST PER TOKEN. v1 has no batch endpoint -- messages:batchSend went
 * with the legacy API -- so a person with two phones is two calls. They run
 * together; an account is a handful of devices, not a fan-out.
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

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
};

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** base64url, no padding -- what JWS wants and what btoa does not give. */
function b64url(bytes: Uint8Array): string {
  let s = "";
  // Built a byte at a time rather than with a spread: String.fromCharCode(...)
  // passes every byte as an argument and blows the stack on a large input.
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

/**
 * Compare two secrets without letting the clock answer the question.
 *
 * Length is allowed to leak -- it is fixed and not a secret -- but a
 * byte-by-byte === that returns early tells a caller how much of a guess was
 * right, one request at a time.
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The service account's private key, as something WebCrypto will sign with.
 *
 * The \n unescaping is not paranoia. The key is a PEM block whose newlines
 * survive JSON.parse as real ones -- unless the secret was pasted through
 * something that escaped them again, which is an ordinary way this gets set.
 * Stripping whitespace alone would leave the two-character sequence in place
 * and the base64 would decode to rubbish, failing at "invalid key" a long way
 * from the cause.
 */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * An access token, minted by the JWT grant and kept while it lasts.
 *
 * Cached at module scope, which on Deno Deploy means for the life of one warm
 * instance. Google issues these for an hour; a minute is held back so a token
 * that expires in flight is not handed to FCM. A cold instance mints its own,
 * and two instances holding two valid tokens is fine -- they are stateless.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount, force = false): Promise<string> {
  if (!force && cached && Date.now() < cached.expiresAt) return cached.token;

  const tokenUri = sa.token_uri ?? GOOGLE_TOKEN_URI;
  const now = Math.floor(Date.now() / 1000);
  const input =
    `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    `${b64urlText(
      JSON.stringify({
        iss: sa.client_email,
        scope: FCM_SCOPE,
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    )}`;

  const key = await importKey(sa.private_key);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)),
  );

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${input}.${b64url(sig)}`,
    }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.access_token) {
    const why = payload?.error_description ?? payload?.error ?? "no access_token";
    throw new Error(`token exchange failed (${res.status}): ${why}`);
  }

  cached = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(0, (Number(payload.expires_in) || 3600) - 60) * 1000,
  };
  return cached.token;
}

/** What happened to one device. */
type Outcome = "sent" | "prune" | "fail";

/**
 * Send to one token and say what to do about it.
 *
 * PRUNING IS NARROW ON PURPOSE. UNREGISTERED means the app was uninstalled or
 * the token rotated, and INVALID_ARGUMENT means it was never a token -- both
 * are dead forever, and a row that stays is a row that fails forever. Anything
 * else is KEPT: an unconfigured APNs key comes back as THIRD_PARTY_AUTH_ERROR
 * and a quota problem as UNAVAILABLE, and deleting live iOS registrations
 * because the Firebase project is half set up would be a silent and
 * unrecoverable loss of exactly the rows this table exists to hold.
 */
async function sendOne(
  projectId: string,
  bearer: string,
  token: string,
  message: Record<string, unknown>,
): Promise<{ outcome: Outcome; status: number; reason?: string }> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, ...message } }),
    },
  );

  if (res.ok) {
    await res.body?.cancel();
    return { outcome: "sent", status: res.status };
  }

  const err = await res.json().catch(() => null);
  const status: string = err?.error?.status ?? "";
  const details: Array<Record<string, unknown>> = err?.error?.details ?? [];
  const code = details.find((d) => typeof d.errorCode === "string")?.errorCode as
    | string
    | undefined;

  const dead =
    code === "UNREGISTERED" || code === "INVALID_ARGUMENT" || status === "INVALID_ARGUMENT";
  return {
    outcome: dead ? "prune" : "fail",
    status: res.status,
    reason: code || status || String(res.status),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const rawServiceAccount = Deno.env.get("FCM_SERVICE_ACCOUNT");

  // The service-role key, and nothing else. Deployed with --no-verify-jwt like
  // its neighbours, so this comparison is the entire door.
  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!presented || !sameSecret(presented, service)) return json({ error: "Unauthorized" }, 401);

  if (!rawServiceAccount) return json({ error: "FCM_SERVICE_ACCOUNT is not set" }, 500);
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(rawServiceAccount);
    if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error("incomplete");
  } catch {
    return json({ error: "FCM_SERVICE_ACCOUNT is not a service-account JSON" }, 500);
  }

  let body: {
    account_id?: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const accountId = (body.account_id ?? "").trim();
  const title = (body.title ?? "").trim();
  const text = (body.body ?? "").trim();
  if (!accountId) return json({ error: "account_id is required" }, 400);
  if (!title) return json({ error: "title is required" }, 400);
  if (!text) return json({ error: "body is required" }, 400);

  /**
   * FCM data values are strings, and only strings.
   *
   * Coerced rather than refused for the primitives, because a trigger building
   * a payload out of a jsonb column has numbers and booleans in it and they
   * mean exactly what their text means. Anything structured is REFUSED: a
   * nested object would arrive on the device as "[object Object]", which is a
   * bug that reaches a person's lock screen before it reaches a log.
   */
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.data ?? {})) {
    if (typeof v === "string") data[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") data[k] = String(v);
    else return json({ error: `data.${k} must be a string, number or boolean` }, 400);
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // push_token has RLS on and no policies at all; the service role bypasses
  // it. Selected by account_id -- never through account_directory, which is a
  // view over app.is_admin() and raises "permission denied for function" for
  // this role rather than returning rows.
  const { data: rows, error: readErr } = await admin
    .from("push_token")
    .select("token")
    .eq("account_id", accountId);

  if (readErr) return json({ error: readErr.message }, 500);

  // No devices is not a failure. Most accounts have none -- every browser-only
  // user, every worker who declined the OS prompt -- and a caller firing on
  // each notification row would otherwise read the normal case as an error.
  if (!rows?.length) return json({ sent: 0, pruned: 0, failed: 0 });

  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (e) {
    return json({ error: `FCM auth failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  const message = {
    notification: { title, body: text },
    ...(Object.keys(data).length ? { data } : {}),
  };

  const attempt = async (token: string) => {
    let r = await sendOne(sa.project_id, bearer, token, message);
    // One retry on an expired bearer: the cached token can lapse between the
    // check above and this request, and re-minting is cheaper than losing the
    // send. Only once, and only for 401 -- anything else is about the device.
    if (r.status === 401) {
      bearer = await accessToken(sa, true);
      r = await sendOne(sa.project_id, bearer, token, message);
    }
    return { token, ...r };
  };

  const results = await Promise.all(
    rows.map((r) =>
      attempt(r.token).catch((e) => ({
        token: r.token,
        outcome: "fail" as Outcome,
        status: 0,
        reason: e instanceof Error ? e.message : String(e),
      })),
    ),
  );

  const dead = results.filter((r) => r.outcome === "prune").map((r) => r.token);
  let pruned = 0;
  if (dead.length) {
    /**
     * Scoped to the account it was read for, not to the token alone.
     *
     * The token is the primary key and signing in MOVES the row, so between
     * the select above and this delete a shared site phone can have been
     * claimed by somebody else. Deleting on the token alone would take the new
     * owner's live registration away on the strength of a verdict about the
     * old one. Matching nothing in that race is the right outcome: the row is
     * now correct, and the next person's device re-registers on sign-in.
     */
    const { data: gone, error: delErr } = await admin
      .from("push_token")
      .delete()
      .eq("account_id", accountId)
      .in("token", dead)
      .select("token");
    if (delErr) console.error("push_token prune failed:", delErr.message);
    pruned = gone?.length ?? 0;
  }

  // Logged, not returned: a caller cannot act on a per-device reason, and the
  // tokens themselves must not travel back out of here.
  for (const r of results) {
    if (r.outcome === "fail") console.error(`push failed (${r.status}): ${r.reason}`);
  }

  return json({
    sent: results.filter((r) => r.outcome === "sent").length,
    pruned,
    failed: results.filter((r) => r.outcome === "fail").length,
  });
});

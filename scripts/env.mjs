import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env.local"), quiet: true });

/** Read a required env var, or fail loudly. A missing credential must never
 *  degrade into a confusing downstream error -- see Phase 0 of the bootstrap. */
export function required(name) {
  const v = process.env[name];
  if (!v || v.startsWith("<")) {
    console.error(
      `\n  Missing ${name} in .env.local\n` +
        `  That file is gitignored; copy .env.local.example and fill it in.\n`,
    );
    process.exit(1);
  }
  return v;
}

export const ROOT = root;

/**
 * Session-pooler connection string.
 *
 * The direct host db.<ref>.supabase.co resolves to IPv6 only and is
 * unreachable from networks without IPv6 egress. The session pooler is IPv4.
 * Session mode (5432), never transaction mode (6543): transaction mode drops
 * prepared statements and session state, which breaks negative-control tests
 * that toggle settings inside a session.
 */
export function connectionString() {
  const explicit = process.env.DATABASE_URL;
  if (explicit && !explicit.includes("<")) return explicit;
  const ref = required("SUPABASE_PROJECT_REF");
  const pw = encodeURIComponent(required("SUPABASE_DB_PASSWORD"));
  return `postgresql://postgres.${ref}:${pw}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`;
}

/**
 * Invoke the pinned local Supabase CLI.
 *
 * Its npm "bin" is a plain Node script, so we run it through process.execPath
 * rather than node_modules/.bin/supabase.cmd. The .cmd shim needs a shell, and
 * this project's absolute path contains spaces ("Bella service"), which the
 * Windows shell splits -- producing
 * "'C:\Users\...\Bella' is not recognized as an internal or external command".
 */
export function supabaseCli(args, opts = {}) {
  return execFileSync(
    process.execPath,
    [path.join(root, "node_modules", "supabase", "dist", "supabase.js"), ...args],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: process.env, ...opts },
  );
}

/**
 * The service-role key, fetched for this run only.
 *
 * Never written to .env.local and never printed: it bypasses RLS entirely, and
 * this repository is public. It lives in memory for the length of one script.
 *
 * WHY THIS IS A FUNCTION RATHER THAN SIX COPIES. bootstrap-admin.mjs and
 * demo-accounts.mjs each hand-rolled the CLI call and then did:
 *
 *     JSON.parse(out.slice(out.indexOf("{"))).keys.find(...).api_key
 *
 * which has three unguarded failure modes on one line. If stdout carries no
 * "{" at all, indexOf returns -1 and slice(-1) hands JSON.parse the last
 * CHARACTER of the output; if stdout is empty or whitespace, JSON.parse throws
 * "Unexpected end of JSON input" -- which is the error demo:reset actually
 * produced, pointing at a line that says nothing about the CLI. And if the
 * key list comes back without a service_role entry, .find() returns undefined
 * and the next property access throws somewhere else again.
 *
 * None of those tell the person running it that the CLI is what went wrong.
 * This says so, and shows what came back instead.
 */
export function serviceRoleKey() {
  const ref = required("SUPABASE_PROJECT_REF");
  let out;
  try {
    out = supabaseCli(["projects", "api-keys", "--project-ref", ref]);
  } catch (e) {
    throw new Error(
      "Could not reach the Supabase CLI to fetch the service-role key.\n" +
      `  ${String(e.stderr || e.message).split("\n")[0]}\n` +
      "  Check SUPABASE_ACCESS_TOKEN in .env.local and that you are online.");
  }

  const start = out.indexOf("{");
  if (start < 0) {
    throw new Error(
      "The Supabase CLI returned no JSON when asked for the project's API keys.\n" +
      `  It printed ${out.length} character(s): ${JSON.stringify(out.slice(0, 200))}\n` +
      "  A version notice on stdout instead of stderr will do this.");
  }

  let parsed;
  try {
    parsed = JSON.parse(out.slice(start));
  } catch {
    throw new Error(
      "The Supabase CLI's API-key output was not valid JSON.\n" +
      `  ${JSON.stringify(out.slice(start, start + 200))}`);
  }

  const key = parsed.keys?.find((k) => k.id === "service_role")?.api_key;
  if (!key) {
    throw new Error(
      "No service_role key in the CLI's response.\n" +
      `  Keys returned: ${(parsed.keys ?? []).map((k) => k.id).join(", ") || "(none)"}`);
  }
  return key;
}

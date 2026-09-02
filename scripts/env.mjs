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

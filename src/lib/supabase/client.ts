import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The one Supabase client. Typed from generated schema types -- never `any`.
 *
 * Why this matters (from CLAUDE.md, learned the hard way): the previous build
 * used an untyped client. A nullable numeric column came back as null, went
 * through Number(null), became 0, and a wrong figure reached the interface with
 * no compile error and no runtime error. `SupabaseClient<Database>` is what
 * makes that a type error instead of a silent lie in a legal document.
 *
 * Run `npm run types:gen` after every migration or these types drift and the
 * guarantee quietly evaporates.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient<Database> | undefined;

export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;

  if (!url || !anonKey) {
    // NEXT_PUBLIC_* values are inlined at build time. If they were absent when
    // the static export was produced, they are absent forever in that bundle --
    // so fail loudly rather than returning a client that 401s on every call.
    throw new Error(
      "Supabase env missing. NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set at build time " +
        "(.env.local locally, repository secrets in CI).",
    );
  }

  client = createClient<Database>(url, anonKey, {
    auth: {
      // No server, so the browser holds the token. Phase 4: persistence and
      // silent refresh.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "shift-setter-auth",
    },
  });

  return client;
}

export type { Database };
export type { Tables, TablesInsert, TablesUpdate, Enums } from "./database.types";

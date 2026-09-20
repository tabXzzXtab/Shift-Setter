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

/**
 * A row whose tenant_id the DATABASE fills in, not this caller.
 *
 * M1c dropped the column default from the seventeen child tables and gave each
 * a BEFORE INSERT trigger that derives tenant_id from the row's parent -- from
 * the project a pass hangs off, the account a worker belongs to, and so on.
 * That is the whole point: a caller cannot pick its own tenancy, and one who
 * names a tenancy the parent disagrees with is refused outright.
 *
 * THE GENERATED TYPES CANNOT KNOW THAT. Supabase derives Insert types from the
 * catalogue, where the rule is simple: NOT NULL and no default means required.
 * Triggers are invisible to it. So every insert in this app became a type error
 * the moment M1c landed, for rows that are correct at run time and have been
 * green in test:db throughout.
 *
 * Sending tenant_id to satisfy the compiler would be worse than the cast: the
 * browser does not know which tenancy a row belongs to -- that is precisely
 * what it is not allowed to decide -- and an operator writing into a client's
 * project would send their own and be refused.
 *
 * So the reason is named once, here, rather than as a bare `as never` at each
 * call site.
 *
 * IT ASSERTS THE ONE FIELD AND NOTHING ELSE. The first version of this
 * returned `never`, which is assignable to every parameter type -- so it did
 * not silence the missing tenant_id, it silenced type checking on the whole
 * argument. A misspelled column, a string where a number belongs, a different
 * required field left out: all of it would have compiled clean, at nine insert
 * sites, in the code path that decides which rows land in whose company. The
 * signature below adds tenant_id to the row's type and leaves every other
 * field checked, which is the width the reason above actually justifies.
 */
export function derivesTenant<T extends object>(rows: T[]): (T & { tenant_id: string })[];
export function derivesTenant<T extends object>(row: T): T & { tenant_id: string };
export function derivesTenant(row: object): never {
  return row as never;
}

#!/usr/bin/env node
/**
 * Compare the live schema against the snapshot committed to the repo.
 *
 *   npm run db:check      -- report drift, exit 1 if any
 *   npm run db:snapshot   -- rewrite the snapshot after applying a migration
 *
 * Claude is the only writer to this database. If the live schema differs from
 * what was last applied, that is a stop-and-ask, not something to reconcile:
 * the schema once changed underneath a patch in progress, and deciding what to
 * do about it required reasoning from row counts to be sure nothing real would
 * be destroyed. This turns "notice the difference" from a hope into a command.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import pg from "pg";
import { connectionString } from "./env.mjs";

const SNAPSHOT = "supabase/schema.snapshot.txt";

/** One text column, deterministically ordered, describing everything that matters. */
const DESCRIBE = `
select line from (
  select 1 as sect, format('enum   %s = %s', t.typname,
           string_agg(e.enumlabel, ',' order by e.enumsortorder)) as line
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
   group by t.typname

  union all
  -- Qualified only outside public, so widening this to the app schema does not
  -- rewrite every existing line. app.acting_tenant is the first table to live
  -- there; until it did, this query had no reason to look.
  select 2, format('column %s.%s %s%s%s',
           case when n.nspname = 'public' then c.relname
                else n.nspname || '.' || c.relname end, a.attname,
           format_type(a.atttypid, a.atttypmod),
           case when a.attnotnull then ' NOT NULL' else '' end,
           coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''))
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname in ('app','public') and c.relkind in ('r','v') and a.attnum > 0 and not a.attisdropped

  union all
  select 3, format('constr %s %s', c.conrelid::regclass, pg_get_constraintdef(c.oid))
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public'

  union all
  select 4, format('index  %s', indexdef)
    from pg_indexes where schemaname = 'public'

  union all
  select 5, format('policy %s.%s [%s] USING(%s) CHECK(%s)', tablename, policyname, cmd,
           coalesce(qual,'-'), coalesce(with_check,'-'))
    from pg_policies where schemaname = 'public'

  union all
  select 6, format('rls    %s enabled=%s', tablename,
           (select relrowsecurity from pg_class c
             join pg_namespace n on n.oid=c.relnamespace
            where c.relname=tablename and n.nspname='public'))
    from pg_tables where schemaname = 'public'

  union all
  select 7, format('trig   %s on %s -> %s enabled=%s', t.tgname, t.tgrelid::regclass,
           p.proname, t.tgenabled)
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal

  union all
  select 8, format('func   %s.%s(%s) md5=%s', n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid), md5(coalesce(p.prosrc,'')))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','public')

  union all
  select 9, format('grant  %s on %s to %s', privilege_type, table_name, grantee)
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','authenticated')

  -- A VIEW'S BODY, WHICH NOTHING ABOVE RECORDS. Section 2 collects a view's
  -- COLUMNS, so until this existed a view could have its WHERE clause rewritten
  -- and db:check reported no drift -- which is exactly what happened when six
  -- of them gained a tenant clause and the snapshot did not move by one line.
  --
  -- That matters more than it used to. These views are security_invoker =
  -- false, so they run as their owner and RLS on the tables underneath does not
  -- apply to them; since M2 their WHERE clause is the only thing keeping one
  -- company out of another's. An unrecorded definition is an unguarded one.
  --
  -- md5 rather than the text, matching how functions are recorded: the bodies
  -- run to twenty lines each and the question the snapshot answers is "has this
  -- changed", not "to what". security_invoker is spelled out because flipping
  -- it is a security change that would not alter the definition at all.
  union all
  select 10, format('view   %s.%s security_invoker=%s md5=%s',
           n.nspname, c.relname,
           coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'false'),
           md5(pg_get_viewdef(c.oid, true)))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app','public') and c.relkind = 'v'

  -- A FUNCTION'S ATTRIBUTES, WHICH SECTION 8 DOES NOT RECORD.
  --
  -- Section 8 md5s p.prosrc, and prosrc IS the body -- the text between the
  -- dollar quotes. So a rewritten body has always been caught, and the story
  -- that migrations landed unseen because bodies were untracked is not what
  -- happened. What prosrc does not contain is everything AROUND the body, and
  -- that is where this project keeps its guarantees:
  --
  --   SECURITY DEFINER   the difference between a function that reaches past
  --                      RLS and one that does not. app.confirms_project(),
  --                      app.in_tenant(), public.delete_pass() and 20-odd
  --                      others are only correct because they are DEFINER.
  --   search_path        "set search_path = ''" on every DEFINER function is
  --                      what stops a caller shadowing "public" with their own
  --                      schema and having the owner run it. Dropping it is a
  --                      privilege escalation that does not touch one line of
  --                      the body.
  --   volatility         a STABLE guard silently turned VOLATILE changes when
  --                      the planner calls it, and an IMMUTABLE one that reads
  --                      a table can be evaluated once and cached wrongly.
  --   return type        a boolean guard made to return NULL instead of false
  --                      is gotcha 3 in CLAUDE.md, arriving by signature.
  --
  -- Flip any of those and section 8's md5 does not move by one character. That
  -- is the actual blind spot, and it is the same shape as the view one that
  -- 2abf8ff closed: not the code, but the setting the code is trusted under.
  --
  -- pg_get_functiondef is the whole CREATE statement, so its md5 covers the
  -- body as well -- deliberately redundant with section 8 rather than replacing
  -- it. Keeping both is what makes a drift report legible: section 8 moving
  -- says the body changed, section 11 moving alone says only the attributes
  -- did, and that second case is the one nobody would otherwise look for.
  -- The four fields are spelled out beside the hash for the same reason
  -- security_invoker is spelled out in section 10 -- so the report NAMES the
  -- change instead of announcing that some hash differs.
  --
  -- prokind is filtered to plain functions because pg_get_functiondef raises
  -- on an aggregate or a window function. All 275 here are 'f' today; the
  -- filter is so that adding one later fails the check rather than the query.
  union all
  select 11, format('funcdef %s.%s(%s) security=%s volatile=%s config=%s returns=%s md5=%s',
           n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
           case when p.prosecdef then 'definer' else 'invoker' end,
           case p.provolatile when 'i' then 'immutable'
                              when 's' then 'stable'
                              else 'volatile' end,
           coalesce(array_to_string(p.proconfig, ','), '-'),
           pg_get_function_result(p.oid),
           md5(pg_get_functiondef(p.oid)))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','public') and p.prokind = 'f'
) s
order by sect, line;
`;

const client = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await client.connect();
const { rows } = await client.query(DESCRIBE);
await client.end();

const live = rows.map((r) => r.line).join("\n") + "\n";

if (process.argv.includes("--write")) {
  writeFileSync(SNAPSHOT, live, "utf8");
  console.log(`Wrote ${SNAPSHOT} (${rows.length} lines).`);
  console.log("Commit it in the same commit as the migration it describes.");
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  console.error(`No ${SNAPSHOT}. Run \`npm run db:snapshot\` to create it.`);
  process.exit(1);
}

const saved = readFileSync(SNAPSHOT, "utf8");
if (saved === live) {
  console.log(`Schema matches ${SNAPSHOT} (${rows.length} objects). No drift.`);
  process.exit(0);
}

const savedSet = new Set(saved.split("\n").filter(Boolean));
const liveSet = new Set(live.split("\n").filter(Boolean));
const added = [...liveSet].filter((l) => !savedSet.has(l));
const removed = [...savedSet].filter((l) => !liveSet.has(l));

console.error("SCHEMA DRIFT -- the live database is not what the repo last applied.\n");
for (const l of removed) console.error(`  - ${l}`);
for (const l of added) console.error(`  + ${l}`);
console.error(
  "\nStop and ask before reconciling. Do not reset, re-push, or 'fix' the live\n" +
  "schema to match: something outside this repo changed it, and the reason\n" +
  "matters more than the difference.",
);
process.exit(1);

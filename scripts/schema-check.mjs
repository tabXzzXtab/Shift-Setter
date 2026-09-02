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
  select 2, format('column %s.%s %s%s%s', c.relname, a.attname,
           format_type(a.atttypid, a.atttypmod),
           case when a.attnotnull then ' NOT NULL' else '' end,
           coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''))
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r','v') and a.attnum > 0 and not a.attisdropped

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

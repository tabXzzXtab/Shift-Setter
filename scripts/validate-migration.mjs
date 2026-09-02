#!/usr/bin/env node
/**
 * Run a migration inside a transaction and ROLL BACK.
 *
 * Proves the SQL parses and executes against the real database -- including
 * plpgsql function bodies, which Postgres syntax-checks at CREATE time -- while
 * leaving the database exactly as it was. "It looks right" is not a status
 * report; this is the cheapest way to make it one before applying anything.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { connectionString } from "./env.mjs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/validate-migration.mjs <path.sql>"); process.exit(1); }

const client = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await client.connect();
try {
  await client.query("begin");
  await client.query(readFileSync(file, "utf8"));

  const counts = await client.query(`
    select
      (select count(*) from pg_tables where schemaname='public') as tables,
      (select count(*) from pg_views  where schemaname='public') as views,
      (select count(*) from pg_policies where schemaname='public') as policies,
      (select count(*) from pg_trigger where not tgisinternal) as triggers,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('app','public')) as functions,
      (select count(*) from pg_tables where schemaname='public' and rowsecurity) as rls_enabled
  `);
  console.log("EXECUTED CLEANLY inside a transaction:");
  console.table(counts.rows);

  const noRls = await client.query(`
    select tablename from pg_tables
    where schemaname='public' and not rowsecurity order by tablename
  `);
  console.log(noRls.rows.length === 0
    ? "RLS: enabled on every table in public"
    : "RLS MISSING ON: " + noRls.rows.map(r => r.tablename).join(", "));
} catch (e) {
  console.error(`\nMIGRATION FAILED: ${e.message}`);
  if (e.position) console.error(`  at character ${e.position}`);
  if (e.where) console.error(`  ${e.where}`);
  process.exitCode = 1;
} finally {
  await client.query("rollback");
  await client.end();
  console.log("\nROLLED BACK - the database is unchanged.");
}

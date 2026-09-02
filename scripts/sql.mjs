#!/usr/bin/env node
/**
 * Run arbitrary SQL against the real database.
 *
 *   npm run db:sql -- --file supabase/tests/foo.sql
 *   npm run db:sql -- --query "select current_database(), current_user, now();"
 *
 * `supabase db push` only applies migration files. Test suites, fixtures,
 * assertions and negative controls need this.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { connectionString } from "./env.mjs";

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i === -1 ? undefined : argv[i + 1];
};

const file = flag("--file");
const query = flag("--query");
// Exploratory reads must not be able to commit. A probe run without this once
// left fixture rows in the database because db:sql auto-commits.
const rollback = argv.includes("--rollback");

if (!file && !query) {
  console.error("usage: npm run db:sql -- (--file <path> | --query <sql>)");
  process.exit(1);
}

const sql = file ? readFileSync(file, "utf8") : query;

const client = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

try {
  await client.connect();
  if (rollback) await client.query("begin");
  const res = await client.query(sql);
  for (const r of Array.isArray(res) ? res : [res]) {
    if (r.rows?.length) console.table(r.rows);
    else console.log(`${r.command ?? "OK"}${r.rowCount != null ? ` (${r.rowCount} rows)` : ""}`);
  }
} catch (err) {
  console.error(`\nSQL FAILED: ${err.message}`);
  if (err.position) console.error(`  at character ${err.position}`);
  process.exitCode = 1;
} finally {
  if (rollback) {
    await client.query("rollback").catch(() => {});
    console.log("(--rollback: nothing was committed)");
  }
  await client.end().catch(() => {});
}

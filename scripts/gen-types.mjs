#!/usr/bin/env node
/**
 * Regenerate src/lib/supabase/database.types.ts from the live schema.
 *
 * MUST run after every migration. The previous build ran an untyped client:
 * Number(null) silently became 0 and wrong numbers reached the interface with
 * no compile error and no runtime error. The generated types are the only
 * thing that catches that class of bug. See CLAUDE.md.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { required, ROOT, supabaseCli } from "./env.mjs";

const ref = required("SUPABASE_PROJECT_REF");
required("SUPABASE_ACCESS_TOKEN"); // consumed by the CLI from the environment

const out = path.join(ROOT, "src/lib/supabase/database.types.ts");

console.log(`Generating types from project ${ref} ...`);
const types = supabaseCli([
  "gen", "types", "typescript", "--project-id", ref, "--schema", "public",
]);

if (!types.includes("export type Database")) {
  console.error("Generator did not return a Database type. Refusing to overwrite.");
  console.error(types.slice(0, 500));
  process.exit(1);
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  "// GENERATED FILE -- do not edit by hand.\n" +
    "// Regenerate with `npm run types:gen` after every migration.\n\n" +
    types,
  "utf8",
);
console.log(`Wrote ${path.relative(ROOT, out)} (${types.length} bytes)`);

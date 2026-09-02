import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // DocMaker source, kept verbatim as the reference for the template port
    // (spec Section 8b). It is not application code and is not built.
    "docs/**",
    // Generated from the live schema by `npm run types:gen`.
    "src/lib/supabase/database.types.ts",
  ]),
]);

export default eslintConfig;

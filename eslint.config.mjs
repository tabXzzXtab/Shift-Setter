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
    // Design handoffs, dropped in as reference. They ship a bundle from the
    // design tool -- ReactDOM.render, an assignment to `module` -- which is
    // not ours, is never built, and turned `npm run verify` red the moment the
    // folder appeared. The screens are RECREATED from these, never imported.
    "**/design_handoff*/**",
    "**/handoff/**",
    "Swedish construction shift scheduler redesign*/**",
    // The Capacitor native shells. `cap add` writes an Xcode and a Gradle
    // tree and COPIES THE BUILT EXPORT INTO BOTH -- minified bundles, plus
    // Capacitor's own runtime JS. None of it is ours and none of it is
    // built from here; linting it turned verify red with 130 errors the
    // moment the folders appeared, exactly as the handoff bundle did. They
    // are gitignored too, but .gitignore does not reach ESLint.
    "ios/**",
    "android/**",
  ]),
]);

export default eslintConfig;

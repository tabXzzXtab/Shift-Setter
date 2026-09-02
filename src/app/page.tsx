import { AuthGate } from "@/components/auth-gate";
import { SignedInPanel } from "@/components/signed-in-panel";

/**
 * Phase 4. Nothing behind the gate yet -- no schema, no features.
 *
 * NEXT_PUBLIC_* is read here, at build time, in a server component: these
 * values are inlined into the static export, so their absence is a build-time
 * fact, not a runtime one. Surfacing it caught a CI run that went green with
 * empty secrets. Neither value is secret; only presence is shown.
 */
const envPresent = {
  NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
};

export default function Home() {
  return (
    <AuthGate>
      <SignedInPanel envPresent={envPresent} />
    </AuthGate>
  );
}

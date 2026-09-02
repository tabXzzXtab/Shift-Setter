/**
 * Phase 3 placeholder. Its only job is to prove the pipeline end to end.
 *
 * It renders the two things that fail silently on GitHub Pages:
 *   - Tailwind classes applying at all (basePath / _next assets resolved)
 *   - NEXT_PUBLIC_* inlined at build time (CI secrets actually wired)
 *
 * Both would otherwise deploy green and be discovered by a human opening the
 * site. Neither value is a secret: the anon key ships to every browser by
 * design, and only its presence is shown here, never the value.
 */
const envPresent = {
  NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
};

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Shift Setter</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Skiftplanering och Arbetsdagbok
        </p>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Build environment
        </p>
        <ul className="mt-3 space-y-1.5 font-mono text-sm">
          {Object.entries(envPresent).map(([key, ok]) => (
            <li key={key} className="flex items-baseline justify-between gap-4">
              <span className="truncate text-neutral-400">{key}</span>
              <span className={ok ? "text-emerald-400" : "text-red-400"}>
                {ok ? "set" : "MISSING"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-neutral-500">
        Foundations only — no schema, no features. See{" "}
        <code className="text-neutral-400">CLAUDE.md</code>.
      </p>
    </main>
  );
}

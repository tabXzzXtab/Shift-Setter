# Bootstrap — Prompt for Claude Code

Paste this into Claude Code in the empty project folder. It sets up foundations only. **No schema, no tables, no features.** Those come after.

---

This is an empty folder. We are building a shift-scheduling system for a Swedish construction company from scratch. A previous version exists and is being abandoned — do not look for it, do not import from it. Everything here is new.

Work through the phases below **in order**. Stop and report at the end of each. Do not start a phase before the previous one is verified working.

---

## Phase 0 — Access, before anything else

The last build lost days to blocked database access discovered mid-work. Prove every credential works now, while nothing depends on it.

Ask me for whatever you need. Do not guess, do not work around a missing credential, and do not proceed on any item below until all four are proven.

**1. Supabase CLI**
- Confirm `supabase` is installed and `supabase login` is authenticated to the account that owns the project.
- Run `supabase projects list` and show me the output. If the target project is not in that list, stop — the CLI is on the wrong account.
- Ask me to create a new Supabase project if one does not exist yet, and tell me exactly what you need from it.

**2. Direct database connection**
- `supabase db push` only applies migration files. We will need to run arbitrary SQL: test suites, fixtures, assertions, negative controls. Set up a direct connection now.
- Ask me for the database password. I will put it in `.env.local` (gitignored). Tell me the exact line to add.
- Install `pg` and prove the connection by running `select current_database(), current_user, now();` and showing me the result.
- Percent-encode the connection string if the password contains reserved characters, rather than reporting a confusing failure.

**3. GitHub CLI**
- Confirm `gh` is installed and `gh auth status` is authenticated.
- Ask me whether to create a new repository or connect to an existing one. Do not create anything without asking.

**4. Deployment target**
- Confirm which account and repository the site deploys from, and the URL it will live at.

**Report all four before continuing.**

---

## Phase 1 — Scaffold

Stack, chosen deliberately:

- **Next.js, App Router, `output: "export"`** — static, no server, deployed to GitHub Pages. This is a real constraint with real consequences: no cron, no scheduled jobs, no server-side secrets, no push notifications without a Supabase Edge Function. Every security rule must live in the database, because the browser holds the token and talks to PostgREST directly. Do not add a Node server.
- **TypeScript, strict mode.**
- **Tailwind.**
- **Supabase** for Postgres, Auth and PostgREST.
- **`pg`** as a dev dependency for executing SQL during development and testing.

Set up:
- The project scaffold, building clean.
- `.gitignore` covering `.env.local`, `node_modules`, `.next`, `out`, and any large binary artifacts.
- `.env.local` for the anon key and URL. Never commit it.
- ESLint and typecheck scripts, both passing on an empty project.

**One hard rule from the previous build:** the Supabase client must be **typed from generated schema types**. Last time it was untyped, `Number(null)` silently became `0`, and wrong numbers reached the interface with no compile error and no runtime error. Set up `supabase gen types typescript` as a script now, wire it into the client, and re-run it after every migration. This is not optional and it is the single most valuable thing in this phase.

---

## Phase 2 — Repository documents

**`CLAUDE.md` in the repo root.** Read at the start of every session. It holds the invariants below verbatim:

```
1.  Hours are typed by a human. Nothing derives them — not from clock stamps,
    not from the start/end span. Unpaid lunch makes span != hours the normal case.
2.  No worker holds two assignments on the same date. Ever.
3.  Clock stamps are append-only evidence. A leader may overwrite the working
    value; the original survives, visible and attributed to whoever changed it.
4.  Only a leader writes hours or confirmation state. Enforced in the database,
    not the interface.
5.  Confirmation is final. No edits after.
6.  The Arbetsdagbok cannot generate with any cell empty — not shifts, not the
    Gjorde text, not the bestallare fields.
7.  Every field the document needs is captured and validated at project creation.
8.  Deleted projects and workers make their shifts count nowhere, in every read.
9.  Dates are Stockholm-anchored. Month windows half-open.
10. Confirmed hours are the only hours shown to a worker.
11. The last active leader cannot be removed, demoted, or paused.

Weakening any of these is a stop-and-ask, never a judgment call.

Working rules:
- Nothing counts until it has run against a real database and matched a
  hand-computed expected value. "Typecheck clean" is not a status report.
- Every test suite ships with negative controls: disable the protection,
  confirm the suite fails at the expected assertion. A suite that would pass
  with the guard removed proves nothing.
- Product decisions are mine, not yours. If a requirement is ambiguous,
  underspecified, or contradicts something already here — stop and ask.
  Do not decide and report afterwards.
- Regenerate Supabase types after every migration.
```

**`docs/spec.md`** — I will supply the full system specification. It lives in the repo and is updated in the **same commit** as the code it describes. A spec that drifts from the code makes both unauthoritative.

---

## Phase 3 — Prove the deploy pipeline

Before there is anything worth losing:

- GitHub Actions workflow building the static export and deploying to Pages.
- Deploy a placeholder page.
- Give me the live URL and confirm it loads.

**Verify the push landed by querying the remote**, not the local tracking branch. A previous session piped `git push` into another command and read the wrong exit code, reporting success on a push that never landed.

---

## Phase 4 — Auth shell

- Supabase Auth with email and password.
- A login gate, with the explicit understanding that it is a courtesy and not a security boundary. An unauthenticated visitor who bypassed it must see empty lists, because the database refuses them — not because the interface hid anything.
- Session persistence and silent token refresh.
- Nothing behind the gate yet.

---

## Stop here

Do not create a single table. Do not write a migration. Do not build a screen.

The schema comes next, as one complete migration, applied and asserted against the real database before any application code touches it. I will supply the full specification and the answers to nine outstanding design questions first.

Report Phases 0–4 and wait.

# Shift Setter

Shift scheduling for a Swedish construction company. The system exists to produce
one document correctly: the **Arbetsdagbok**. Everything else fills its cells.

Full specification: [docs/spec.md](docs/spec.md).

---

## Invariants

```
1.  Hours are typed by a human. Nothing derives them — not from clock stamps,
    not from the start/end span. Unpaid lunch makes span != hours the normal case.
2.  No worker holds two assignments on the same date. Ever.
3.  Clock stamps are append-only evidence. A leader may overwrite the working
    value; the original survives, visible and attributed to whoever changed it.
4.  Only a leader writes hours or confirmation state. Enforced in the database,
    not the interface.
4b. An arbetsledare confirms only for projects they are assigned to. This is a
    per-row scope, not a role check - the database must enforce it row by row.
5.  Confirmation is final. No edits after.
6.  The Arbetsdagbok cannot generate with any cell empty — not shifts, not the
    "Vad Vi Gjorde" text, not the bestallare fields.
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

---

## The admin is not above the leader on one thing

**The admin cannot confirm days.** Only the assigned arbetsledare can. That is
the pressure the whole system runs on; letting the owner confirm would
rubber-stamp days he was not present for.

When days are missing, the admin goes through the **bristsurvey** and
reconstructs them from registered data. A surveyed day is a confirmed day: it
leaves the leader's queue permanently and never returns. `project_day.confirmed_via`
records which route was taken, because a leader confirming from site and an
owner reconstructing from phone calls are different claims about the same hours.

In the database this is `app.confirms_project()` -- which deliberately does NOT
fall back to `is_admin()` -- as distinct from `app.leads_project()`, which does.
Do not merge them.

---

## Design, until it works

- **Black and white.** No styling before function.
- **The calendar is the exception** -- drag-to-paint needs real layout from the start.
- **Mobile first, always.** Every screen designed for a phone, then adapted upward.
- Built so a child could use it: large targets, obvious affordances, minimal per screen.

---

## Architecture, and what it forbids

Static export to GitHub Pages. **There is no server.** The browser holds the auth
token and talks to PostgREST directly.

- Every restriction that lives in the interface is decorative. The database is
  the only real boundary — RLS policies and triggers, never client checks.
- Column-level grants cannot separate roles: every logged-in user is the same
  database role, so a grant restricting workers restricts leaders identically.
  **Triggers comparing OLD and NEW are the mechanism that works.**
- No cron, no scheduled jobs, no server-side secrets, no push notifications
  without a Supabase Edge Function.
- Account creation needs elevated credentials, so it runs through a separate
  function with its own deployment path.
- Role is read from the database, not the token, so a role change takes effect
  on next load instead of persisting stale for the token's lifetime.
- **Do not add a Node server.**

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server — **http://localhost:3000/Shift-Setter/** (basePath, see below) |
| `npm run build` | Static export to `out/` |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` then `tsc --noEmit` |
| `npm run verify` | lint + typecheck + build |
| `npm run types:gen` | **Regenerate `src/lib/supabase/database.types.ts`. Run after every migration.** |
| `npm run db:sql -- --query "select 1;"` | Arbitrary SQL against the real database |
| `npm run db:sql -- --file path/to.sql` | Same, from a file — test suites, fixtures, negative controls |

---

## Environment facts

These were established in Phase 0 by testing, not assumption. Changing them
without re-testing reintroduces failures that already cost days.

- **The direct database host is unusable.** `db.<ref>.supabase.co` resolves to
  IPv6 only; this network has no IPv6 egress (`ENOTFOUND`). All SQL goes through
  the **session pooler**, `aws-0-eu-west-2.pooler.supabase.com:5432`, user
  `postgres.<ref>`. Session mode, **never** transaction mode (6543) — transaction
  mode drops prepared statements and session state, which breaks negative
  controls that toggle settings inside a session.
- **`basePath` is hardcoded** to `/Shift-Setter` in `next.config.ts`, not read
  from an env var. Pages serves from a subpath; a CI job that forgets to set the
  var deploys green and renders a blank page.
- **The database server's TimeZone is UTC.** Invariant 9 requires explicit
  `AT TIME ZONE 'Europe/Stockholm'`; nothing may rely on a server default.
- **The Supabase CLI shim cannot be exec'd directly** — this project's absolute
  path contains a space (`Bella service`). `scripts/env.mjs` invokes its Node
  entrypoint through `process.execPath`. Use `supabaseCli()` from there.
- `.env.local` holds the database password and the access token. Gitignored.
  Never commit it, never echo it into a log, never inline it in a workflow file.

---

## Database gotchas, each found by a failing test

Four things that cost time here already. Changing any of them without re-running
`npm run test:db` reintroduces a failure that was real, not theoretical.

1. **RLS is re-applied to the row a BEFORE UPDATE trigger produces.** A SELECT
   policy carrying `deleted_at is null` therefore makes soft-delete impossible:
   the new row fails its own policy the instant the column is set. That is why
   `public.delete_pass()` exists as a SECURITY DEFINER RPC. Do not "simplify" it
   back into a plain UPDATE from the client.
2. **RLS policy expressions run with the CALLING role's privileges**, not the
   table owner's. `authenticated` needs `usage` on schema `app` and `execute` on
   its functions, or every policy raises "permission denied for function" and a
   logged-in user can read nothing. The functions still are not RPC-callable:
   PostgREST only serves its exposed schemas, and `app` is not one.
3. **A null role must be a denial.** `app.current_role()` returns NULL for a
   missing or paused account. `NULL = 'admin'` is NULL, and `if not NULL then
   raise` never fires -- so every helper coalesces to false. Never write a guard
   that relies on a three-valued result.
4. **`now()` is transaction-start time and is constant for the whole
   transaction.** Two writes in one transaction get identical timestamps, so a
   test that "changes" a value to `now()` changes nothing.

Related: an UPDATE blocked by RLS **filters to zero rows, it does not raise**.
Assert on state, not on an exception, when testing that someone cannot write.

---

## The database has one writer

Claude applies every schema change. Nobody edits the live database by hand.

```bash
npm run db:check      # live schema vs supabase/schema.snapshot.txt
npm run db:snapshot   # rewrite the snapshot -- same commit as the migration
```

**Run `db:check` before applying anything.** If it reports drift, **stop and
ask**. Do not reset, re-push, or reconcile the schema to match: something
outside this repo changed it, and the reason matters more than the difference.
This exists because the schema once changed underneath a patch in progress, and
deciding whether a reset was safe meant reasoning from row counts to be sure
nothing real would be destroyed.

---

## Testing

```bash
npm run test:db
```

Runs `supabase/tests/suite.sql` against the real database, then runs it again
once per negative control with a single guard disabled. A control passes only
when the suite fails at the SPECIFIC assertion that guard holds up -- failing
somewhere else means the assertion rested on something other than the guard.
Every run is wrapped in a transaction and rolled back.

`npm run db:sql` **commits**. Use `-- --rollback` for anything exploratory; a
probe run without it once left fixture rows in the database.

---

## Deployment

- Repo: `tabXzzXtab/Shift-Setter` (public)
- Supabase project: `ahujmzahjuvnlzbyyycc`, eu-west-2
- Live: **https://tabxzzxtab.github.io/Shift-Setter/**

`docs/spec.md` is updated in the **same commit** as the code it describes. A spec
that drifts from the code makes both unauthoritative.

# Shift Setter

Shift scheduling for a Swedish construction company. The system exists to produce
one document correctly: the **Arbetsdagbok**. Everything else fills its cells.

Full specification: [docs/spec.md](docs/spec.md).

---

## Invariants

```
1.  Hours are typed by a human. Nothing derives them — not from clock stamps,
    not from the start/end span. Unpaid lunch makes span != hours the normal case.
    A new shift's hours field is PREFILLED as (end - start) - 30 min and stays
    editable; it stops following the span the moment someone types over it, and
    nothing recomputes it afterwards. A number a human must accept or correct is
    not a derived number.
    An auto-assigned arbetsledare's hours are prefilled from the workers' span
    and stay editable: a number a human must accept or correct is not a derived
    number. One true exception, the bristsurvey — on a day no leader confirmed,
    hours come from the clock span where the worker clocked both ends and the
    planned figure where they did not. Nobody types those. That path, no other.
2.  No worker holds two assignments on the same date. Ever. One exception,
    arbetsledare only: a leader auto-assigned to two projects holds a day on
    each, hours computed per project, a row in each Arbetsdagbok. Nothing but
    auto-assignment creates it and it never extends to arbetare.
3.  Clock stamps are append-only evidence. A leader may overwrite the working
    value; the original survives, visible and attributed to whoever changed it.
4.  An arbetare never writes hours or confirmation state. A leader writes them
    at stage 1; the admin writes them at stage 2 and on the two routes that
    reach admin_confirmed with no leader behind them. Enforced in the database,
    not the interface. The worker side has not moved.
4b. An arbetsledare confirms only for projects they are assigned to. This is a
    per-row scope, not a role check - the database must enforce it row by row.
    A flagged day is outside every leader's scope: admin and only admin.
5.  Confirmation is final at each stage. A leader cannot edit a day after
    confirming it. Stage 2 may approve, edit and approve, or reject it back to
    the leader — rejection is the only thing that reopens a day. Once
    admin_confirmed, nothing edits it.
6.  The Arbetsdagbok cannot generate with any cell empty — not shifts, not the
    "Vad Vi Gjorde" text, not the bestallare fields.
7.  Every field the document needs is captured and validated at project creation.
8.  Deleted projects and workers make their shifts count nowhere, in every read.
9.  Dates are Stockholm-anchored. Month windows half-open.
10. A worker sees their hours only once an Arbetsdagbok covering that date has
    been generated, and the number is exactly what was filed. Confirmation
    alone is not enough — a confirmed day can still be edited at stage two.
11. The last active admin cannot be removed, demoted, or paused. Only an admin
    can change a role, so an admin is the one whose disappearance cannot be
    recovered from inside the app. The guard counts active admins; it does
    not protect the last arbetsledare.

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

**The admin cannot make a stage 1 confirmation.** Only the assigned
arbetsledare can. That is the pressure the whole system runs on; letting the
owner make that claim would rubber-stamp days he was not present for.

Confirmation happens twice. The leader states what happened and the day becomes
`leader_confirmed`. The admin then reviews it: approve, edit and approve, or
reject it back to the leader. Approval is `admin_confirmed`. **Reviewing a
claim is not making one**, and the Arbetsdagbok generates from
`leader_confirmed` — stage 2 is not a gate.

Three routes reach `admin_confirmed`. Only the first has a leader behind it:

- **Stage 2 approval.** A leader confirmed; the admin signed off, edits or not.
- **Bristsurvey.** The leader never confirmed. The admin supplies the day's
  account and the registered figures stand in for confirmed ones. It writes
  straight to `admin_confirmed` and never enters the stage 2 queue.
- **A flagged day.** The day ran with a worker as ansvarig, or with nobody at
  all, so there was no leader to make the claim. Admin and only admin confirms
  it, and `confirmed_via` keeps those two cases apart — a covered day and an
  unattended one are different admissions.

A surveyed day is a confirmed day: it leaves the leader's queue permanently and
never returns. `project_day.confirmed_via` records which route was taken,
because a leader confirming from site and an owner reconstructing from phone
calls are different claims about the same hours. The stage is a separate axis
from the route, and one column cannot carry both.

In the database this is `app.confirms_project()` -- which deliberately does NOT
fall back to `is_admin()` -- as distinct from `app.leads_project()`, which does.
Do not merge them. Stage 2, the bristsurvey and flagged days are separate
writes that reach `admin_confirmed` without passing through it. They are not a
reason to relax it.

---

## Design, until it works

- **Black and white.** No styling before function.
- **The shift calendar is the one place colour is allowed**, because there it
  carries meaning: a project's colour is what makes "Tuesday is two different
  sites" visible without reading. A fixed palette, not a hashed hue -- hashing
  produces neighbouring greens eventually, and two sites that look alike is the
  failure the colour exists to prevent.
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

## Next.js 16

This is not the Next.js most training data describes -- APIs, conventions and
file structure differ. Read the relevant guide in `node_modules/next/dist/docs/`
before writing framework code.

(`next dev` wants to append this itself on every run; `agentRules: false` in
`next.config.ts` stops it, because nothing automated edits this file.)

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
| `npm run test:db` | Assertion suite + 14 negative controls, all rolled back |
| `npm run walkthrough` | Drive the whole slice in a browser; artifacts to `artifacts/` |
| `npm run walkthrough:tiers` | Förval, the tiers and Acceptera Pass in a browser |
| `npm run walkthrough:batch` | A month generated by **touch**, one instance edited, the cascade |
| `npm run walkthrough:snabb` | Snabb Pass: leader creates one, admin adds an off-roster worker |
| `npm run walkthrough:kalender` | Shift calendar: colours, continuous bars, delete rules |
| `npm run walkthrough:brist` | Bristsurvey: the warning, whose job it was, one question per day |
| `npm run demo:reset` | Clear demo data **and** recreate the stable demo logins |
| `npm run test:race` | Two concurrent accepts on a one-slot pass, N rounds |
| `node scripts/long-doc-check.mjs` | Print a long Arbetsdagbok; assert no header/footer overlap |
| `node scripts/pdf-download-check.mjs <from> <to> [projekt]` | Download the PDF; assert filename, pages, bands |

Account creation runs through the `create-account` Edge Function, because it
needs the service-role key. Deploy it with:

```bash
node -e "require('child_process').execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','functions','deploy','create-account','--project-ref',process.env.SUPABASE_PROJECT_REF,'--no-verify-jwt','--use-api'],{stdio:'inherit',env:process.env})"
```

The founding admin cannot come from that function (it requires an admin
caller), so it is created once by `node scripts/bootstrap-admin.mjs <email>
<password>` -- the same single-writer route as schema.

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

## Two things that make a browser test lie

1. **`getByText` matches substrings.** Asserting "24 pass" also matches the
   button "Skapa 24 pass", so a failed generation read as a success. Assert on
   something only the destination has.
2. **Touch and mouse are different code paths.** Touch fires no enter/leave on
   the elements a finger slides across, so a hover-driven grid marks one cell
   and nothing else while a mouse test passes. The calendar gestures are driven
   through CDP `Input.dispatchTouchEvent`, not `page.mouse`.

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

The maintenance reset deletes every non-admin account, so a login handed to
someone stops working the moment it runs. Always use `npm run demo:reset`,
which recreates the stable demo accounts from `.env.local` afterwards.

---

## Deployment

- Repo: `tabXzzXtab/Shift-Setter` (public)
- Supabase project: `ahujmzahjuvnlzbyyycc`, eu-west-2
- Live: **https://tabxzzxtab.github.io/Shift-Setter/**

## The Arbetsdagbok has two renderers

The **PDF is the deliverable**, drawn by `src/lib/doc/pdf.ts` with pdf-lib. A
static export has no server, and `window.print()` cannot be told to save a
file -- it always opens a dialog -- so the document is drawn rather than
printed. Helvetica, so no font is embedded and the file stays small; WinAnsi
covers åäö, and anything outside it is folded before drawing rather than
throwing mid-document.

`src/components/arbetsdagbok-document.tsx` is the **on-screen preview** only.
Both read the same `DocPayload`, so they cannot disagree about content -- but
they can drift on layout. `check:pdf-download` guards the file that actually
leaves the building.

---

`docs/spec.md` is updated in the **same commit** as the code it describes. A spec
that drifts from the code makes both unauthoritative.

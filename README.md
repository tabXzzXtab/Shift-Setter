# Shift Setter

Shift scheduling and **Arbetsdagbok** generation for a Swedish construction company.

- **Live:** https://tabxzzxtab.github.io/Shift-Setter/
- **Invariants and working rules:** [CLAUDE.md](CLAUDE.md) — read first
- **Full specification:** [docs/spec.md](docs/spec.md)

## Stack

Next.js (App Router, static export) · TypeScript strict · Tailwind · Supabase
(Postgres, Auth, PostgREST). No server — the browser talks to PostgREST directly,
so every security rule lives in the database.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev                        # http://localhost:3000/Shift-Setter/
```

`.env.local` is gitignored and holds the database password and Supabase access
token. It is never committed.

## Commands

```bash
npm run verify      # lint + typecheck + build
npm run types:gen   # regenerate DB types — required after every migration
npm run db:sql -- --query "select now();"
npm run db:sql -- --file supabase/tests/some_suite.sql
```

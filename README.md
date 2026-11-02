# The Human Experiment

A small internet experiment. **Experiment 01, "Save the Plant":** strangers around the world water one shared pixel-art plant, once per 24 hours each, and try to keep it alive.

> One planet. Millions of strangers. One very thirsty plant.

- Stack: Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Framer Motion · Supabase (PostgreSQL) · Vercel
- Optional, free: Cloudflare Turnstile (bot check), PostHog (analytics). Both are off unless their keys are set.
- No accounts, no e-mail collection, no paid dependencies.

## How it works

- **One shared state.** The plant's counters live in PostgreSQL. Every number on the site is calculated from real watering events. Nothing is simulated.
- **All game logic is in the database.** `water_experiment()` is a single atomic function. It locks the state row, applies the daily health decay once per UTC day, checks the visitor's 24-hour cooldown, inserts the watering, updates the counters and returns the new state. Concurrent waterings are serialised, so counts can't be lost or double-counted.
- **Anonymous identity.** A random browser ID is held in a signed, HTTP-only cookie (backed up in local storage). Only an HMAC hash of it is stored. Identity is per browser, not per person. See [Known limitations](#known-limitations).
- **Locked-down database.** Row Level Security is on for every table. The public (anon) key can read only three aggregate views. Every function is executable by the server-side `service_role` only.

### Game rules (single source of truth: `lib/plant.ts` and the SQL migrations)

| Stage | Name | Waterings needed |
|---|---|---|
| 0 | Seed | 0 |
| 1 | Sprout | 25 |
| 2 | Tiny plant | 100 |
| 3 | Growing plant | 300 |
| 4 | Bushy plant | 750 |
| 5 | Flowering plant | 1,500 |
| 6 | Legendary plant | 3,000 |

- Health starts at 70 and stays between 0 and 100.
- Each UTC day it loses 2 points. The decay for a given day is applied exactly once (the last processed date is stored).
- Each 10th valid watering in a UTC day gives +1 health.

## Run it locally

Requirements: Node 20+ and (for the local database) PostgreSQL 14+ server binaries (`initdb`, `pg_ctl`). Or skip the local database and use a free Supabase project (see [DEPLOYMENT.md](DEPLOYMENT.md)).

```bash
npm install
cp .env.example .env.local        # then edit it (see below)
npm run db:local                  # starts + migrates a local Postgres, prints LOCAL_DATABASE_URL
npm run dev                       # http://localhost:3000
```

In `.env.local` set at least:

- `VISITOR_COOKIE_SECRET`: any random string of 32+ characters. Generate one with `openssl rand -base64 48`.
- `LOCAL_DATABASE_URL`: the value printed by `npm run db:local`.

`LOCAL_DATABASE_URL` is development-only. It is ignored in production builds and on Vercel.

The local database lives outside the project folder (`~/.cache/the-human-experiment/local-db`, or `LOCAL_DB_DIR`). `npm run db:local -- reset` wipes it, `-- stop` stops it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Standard Next.js |
| `npm test` | Full test suite (boots a throwaway PostgreSQL; no Supabase account needed) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run db:local` | Local development database |
| `npm run db:bundle` | Rebuilds `supabase/setup.sql` from the migrations (a test fails if it's stale) |
| `npm run verify -- <url>` | Smoke test against a running deployment (see the launch checklist) |

## Tests

`npm test` runs 300+ tests against a real PostgreSQL with Supabase-style roles, including:

- growth boundaries at every stage, health decay and recovery, once-per-day processing
- cooldown at exactly 24 hours, duplicate and retried requests
- concurrency: many parallel waterings, same visitor racing itself, counts stay exact
- security: anon cannot read tables, call functions or write; views expose no identifiers
- API validation, status codes, cookie flags, forged and cross-secret cookies, CSRF guard
- share logic, formatting, pixel-art integrity, analytics PII filter

## Project layout

```
app/                      routes (/, /about, /privacy, /contact, /c/[n], /api/*), icons, OG images
components/experiment/    live panel: provider (polling, watering), plant stage, meters, button
components/{share,history,layout,plant}/
lib/handlers.ts           API route logic (framework-agnostic, fully tested)
lib/visitor.ts            cookie signing, hashing, visitor resolution
lib/plant.ts              stages, health constants, shared types
lib/client/               browser-only helpers (API client, analytics, formatting)
supabase/migrations/      the schema, RLS, functions (source of truth)
supabase/setup.sql        all migrations in one paste-able file (generated)
scripts/                  local DB, migration bundler, deployment verifier
tests/                    db/, api/, unit/
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/experiment` | Current state and whether this visitor can water now. Never cached. |
| `POST /api/water` | Water the plant. Body: `{ "requestId": "<uuid>", "turnstileToken"?: "..." }`. `201` new, `200` duplicate retry, `429` cooldown / rate limit. |
| `GET /api/history?days=14` | Per-day totals and reached milestones. Edge-cacheable for 30 s. |

## Analytics events (only when `NEXT_PUBLIC_POSTHOG_KEY` is set)

`homepage_viewed`, `experiment_viewed`, `water_button_clicked`, `watering_success`, `watering_rejected`, `share_clicked`, `share_completed`, `milestone_unlocked`.
Properties are filtered so tokens, cookies, hashes, e-mails and IPs can't be sent. Autocapture and session recording are off.

## Known limitations

- **Identity is per browser.** Another browser, a private window or cleared site data can water again. The site doesn't fingerprint visitors. This keeps it anonymous and is stated on the Privacy page. Turnstile and rate limits reduce automated abuse but can't make "one person, one watering" true.
- **Health recovery is applied immediately.** The brief says +1 health per 10 valid daily waterings. This implementation applies each +1 as soon as the 10th, 20th, 30th… watering of the UTC day happens (capped at 100), and the daily −2 decay is applied once at the start of each new UTC day.
- **Missing contribution pages return HTTP 200** with a "not found" page marked `noindex` (a consequence of streaming dynamic routes with Cache Components).
- **In-memory read limiter** is per serverless instance. It's a courtesy limit, not a security boundary. The write path uses a database-backed limiter shared across instances.
- **The free Supabase tier pauses** projects after about a week of inactivity. Keep it warm during testing or upgrade before launch.

## Docs

- [DEPLOYMENT.md](DEPLOYMENT.md): Supabase + Vercel, step by step
- [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md): before testing with friends, and before buying a domain

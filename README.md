# DriveEasy

Car rental web app for the UAE: search by branch and dates, book with extras, pay, and get a pick-up voucher. Admins manage the fleet, pricing, check-out/check-in and damage. Built with Next.js 16 (App Router), TypeScript, Tailwind, Drizzle ORM + PostgreSQL, Better Auth, Zod, Vitest and Playwright.

Currency is AED. All money is stored and passed around as integer **fils** (1 AED = 100 fils) and formatted only in the UI.

## Local setup

Requirements: Node 20+, pnpm, and PostgreSQL 16+ running locally (developed on 18).

```bash
pnpm install
cp .env.example .env.local      # then fill in the <...> values (see below)
pnpm db:setup                   # creates the driveeasy user + driveeasy_dev / driveeasy_test, installs btree_gist
pnpm db:migrate                 # applies ./drizzle migrations to driveeasy_dev
pnpm db:seed                    # wipes and reseeds driveeasy_dev with demo data
pnpm dev                        # http://localhost:3300
```

`pnpm db:setup` connects as the `postgres` superuser (password from pgpass or `PG_ADMIN_URL`). It is safe to re-run.

### Seeded accounts (local only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@driveeasy.test` | `DriveEasy-Admin-1` |
| Customer (has bookings) | `customer@driveeasy.test` | `DriveEasy-Customer-1` |
| Customer (no bookings) | `customer2@driveeasy.test` | `DriveEasy-Customer-2` |

The seed creates:
- 5 branches: Dubai Airport DXB, Dubai Marina, Downtown Dubai, Abu Dhabi, Sharjah.
- 5 categories and 21 vehicles with features.
- 5 extras: child seat, GPS, additional driver, full insurance, prepaid fuel.
- Pricing rules: standard, weekly, year-end peak, and a DXB luxury premium.
- A maintenance block.
- Bookings DE-SEED01..05 (confirmed, one picked up, one returned). Dates are relative to the day you run the seed.

Seeded payments use the provider name `seed`, so refunds and deposit releases on them are recorded locally without calling a payment provider.

## Environment variables

All settings are server-side (`src/server/env.ts` validates them). Nothing secret uses a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
|---|---|
| `APP_URL`, `BETTER_AUTH_URL` | Public base URL (`http://localhost:3300` locally) |
| `DATABASE_URL` | App connection. In production, the **pooled** URL (e.g. Neon `-pooler` host) |
| `DATABASE_URL_UNPOOLED` | Direct connection used by migrations (optional locally) |
| `TEST_DATABASE_URL` | `driveeasy_test`, used by automated tests |
| `DB_POOL_MAX` | Max connections per server instance (default 10; use ~5 on serverless) |
| `BETTER_AUTH_SECRET` | 32+ random characters |
| `PAYMENT_PROVIDER` | `fake` (local) or `stripe` |
| `PAYMENT_WEBHOOK_URL`, `PAYMENT_WEBHOOK_SECRET` | Fake provider webhook target and HMAC secret |
| `FAKE_PAYMENT_DUPLICATE_WEBHOOKS` | `true` to deliver every fake webhook twice (tests de-duplication) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe **test-mode** keys when `PAYMENT_PROVIDER=stripe` |
| `STORAGE_DRIVER`, `LOCAL_UPLOADS_DIR`, `BLOB_READ_WRITE_TOKEN`, `S3_*` | Private uploads (licences, damage photos) |
| `SCHEDULER`, `CRON_SECRET` | Cron trigger mode and the bearer secret the cron endpoint requires |
| `HOLD_TTL_MINUTES` | How long a PENDING booking holds a car (default 15) |
| `VAT_RATE_BPS` | VAT in basis points (default 500 = 5%) |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` (JSON logs on stdout) |

Switching from the local stand-ins to cloud services is a settings change only (`PAYMENT_PROVIDER`, `STORAGE_DRIVER`, `SCHEDULER`, database URLs).

## Database and migrations

- Schema: `src/server/db/schema.ts` (Drizzle). Migrations: `drizzle/` (SQL, committed).
- Change the schema: edit `schema.ts`, then run `pnpm db:generate` to write a new migration and `pnpm db:migrate` to apply it.
- SQL that Drizzle can't express goes in a custom migration (`pnpm drizzle-kit generate --custom --name <name>`).
- `pnpm db:migrate` migrates `DATABASE_URL_UNPOOLED ?? DATABASE_URL`, and `pnpm db:migrate:test` migrates `TEST_DATABASE_URL`.
- `pnpm db:reset [--test]` drops and recreates the schema, migrates and seeds. It refuses non-local hosts unless you pass `--force`.

**Overlap protection.** A vehicle can never have two overlapping *blocking* periods. Blocking periods are reservations in `PENDING`, `CONFIRMED` or `PICKED_UP`, plus maintenance blocks.
- An exclusion constraint can't span two tables, so triggers on `reservations` and `maintenance_blocks` copy each blocking period into a single table, `vehicle_blocks`.
- That table has `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)`, where periods are `tstzrange` with `[)` bounds. Back-to-back rentals therefore don't conflict.
- When a reservation leaves a blocking status, the trigger deletes its row.
- All of this lives in `drizzle/0001_vehicle_blocks_exclusion.sql`.
- On top of the constraint, `reserve()` takes a row lock on the vehicle (`SELECT … FOR UPDATE`), expires stale holds and checks overlaps. A constraint violation (`23P01`, or `40P01` under contention) becomes a clean "no longer available" error.

**Booking flow.**
1. `reserve()` creates a `PENDING` hold for `HOLD_TTL_MINUTES`. The price is computed on the server.
2. `startCheckout()` authorises the security deposit, then charges the total. Both calls use idempotency keys stored in the database.
3. The booking becomes `CONFIRMED` only after a verified payment and a held deposit. "Verified" means the provider's response to our server-side call, or a signature-checked webhook.
4. Webhooks are de-duplicated by event id.
5. Expired holds are released by `pnpm jobs:release-expired-holds`, or by `GET /api/cron/release-expired-holds` with `Authorization: Bearer $CRON_SECRET`. The job is idempotent and refunds money that arrived after a hold expired.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3300/api/cron/release-expired-holds
```

**Pricing.**
- Days = ceil(duration / 24h), with a minimum of 1.
- The daily rate comes from the best matching pricing rule.
- Extras are priced per day (optionally capped) or per rental.
- A one-way fee is charged when the car is returned to a different branch. Staff bring the car back to its home branch.
- VAT is 5% on rental + extras + fees. The deposit is held, not charged, and not taxed.
- Late return: each started hour past a 59-minute grace period costs 1/24 of the daily rate, capped at one day per 24h, plus VAT. It is captured from the deposit at check-in.
- Cancellation is free until 48h before pick-up. After that the fee is one day's rate incl. VAT, and cancelling is not possible after pick-up.

Server functions are listed in `docs/TEAM.md` ("Server API contract").

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test                 # Vitest unit + integration tests in src/** (uses driveeasy_test)
pnpm test:integration     # QA integration suite (tests/**, resets driveeasy_test)
pnpm test:e2e             # Playwright (desktop + mobile)
```

- `pnpm test` migrates `driveeasy_test` under a Postgres advisory lock and creates uniquely named fixtures, so it never wipes data.
- The QA suite resets the test database under the same lock. Don't run the two suites at the same time.
- Covered: the pricing engine, the reserve transaction (including concurrent overlapping bookings: exactly one wins), payments with the fake provider (decline/retry, double submit, 3-D Secure style `requires_action`, duplicate webhooks, late payments after expiry), cancel/modify/refund, check-out/check-in late fees, the cron and webhook routes, and the Stripe adapter (mocked HTTP).

To check migrations on an empty database: `pnpm db:reset --test --no-seed` (or let the QA harness reset it).

## Deploying to Vercel

> **BLOCKED:** these steps are prepared but have not been run. No cloud accounts were used during development. Live Stripe, Neon, Blob and Vercel Cron verification is pending the project owner's accounts.

1. **Database.** Add Neon (Vercel Marketplace → Storage → Neon) to the project. It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) for Production and Preview. Keep `DB_POOL_MAX` small (e.g. 5).
   - btree_gist is created by the first migration (`CREATE EXTENSION IF NOT EXISTS btree_gist`). It's a trusted extension, so the database owner can install it.
2. **Build.** `vercel.json` sets `buildCommand` to `pnpm db:migrate && pnpm build`, so every deployment applies pending migrations over the unpooled URL before building. Preview deployments migrate their own (branch) database.
3. **Environment variables** (Project → Settings → Environment Variables, Production and Preview):
   - `APP_URL`, `BETTER_AUTH_URL`: the deployment URL
   - `BETTER_AUTH_SECRET`
   - `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PUBLISHABLE_KEY=pk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…`
   - `STORAGE_DRIVER=vercel-blob` + `BLOB_READ_WRITE_TOKEN` (added automatically by the Blob integration)
   - `SCHEDULER=cloud-cron`, `CRON_SECRET` (16+ random characters)
   - `HOLD_TTL_MINUTES`
4. **Stripe webhook.** In the Stripe dashboard (test mode), add the endpoint `https://<domain>/api/webhooks/payments` with these events:
   - `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.requires_action`
   - `payment_intent.amount_capturable_updated`, `charge.refunded`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Cron.** `vercel.json` schedules `/api/cron/release-expired-holds` every 5 minutes. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set. The Hobby plan only allows daily crons; that still works because `reserve()` also expires stale holds for the car being booked.
6. **Seed (optional, non-production).** `DATABASE_URL=<preview url> pnpm db:seed`.
7. **Verify.** Sign up, book with a Stripe test card (`4242 4242 4242 4242`; `4000 0025 0000 3155` for 3-D Secure), cancel, and check refunds in the Stripe dashboard. Also confirm that the cron endpoint returns 401 without the secret.

## Project layout

- `src/app/`: pages, server actions and route handlers (`/api/auth`, `/api/cron`, `/api/webhooks`).
- `src/server/`: server-only code:
  - `db`: schema, seed, test helpers
  - `catalog`: search and availability
  - `pricing`
  - `reservations`: reserve, cancel, modify, check-out/in, damage
  - `payments`: fake and Stripe providers, checkout, webhooks, refunds
  - `admin`, `customers`, `auth`, `jobs`, `storage`, `audit`, `log`
- `drizzle/`: SQL migrations.
- `scripts/`: setup, migrate, seed, reset, jobs.
- `tests/`, `e2e/`: QA integration and Playwright suites.
- `docs/TEAM.md`: team contract and server API.
- `TASKS.md`: task list.

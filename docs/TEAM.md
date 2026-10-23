# DriveEasy team contract

Shared decisions for the three agents. Change this file only by agreement
(message the other agents) and note the change at the bottom.

## Team
| Name | Role | Owns (only this agent edits) |
|---|---|---|
| `db-agent` | Database Engine | `src/server/db/**`, `drizzle/**`, `src/server/reservations/**`, `src/server/pricing/**`, `src/server/payments/**`, `src/server/jobs/**`, `src/server/auth/**`, `src/app/api/cron/**`, `src/app/api/webhooks/**`, `scripts/**`, `vercel.json` |
| `app-agent` | App / UI | `src/app/**` (except the API routes above), `src/components/**`, `src/lib/**`, `src/server/storage/**`, `public/**` |
| `qa-agent` | QA | `e2e/**`, `tests/**`, `docs/BUGS.md` |

Shared: `TASKS.md` (everyone), `README.md` (db-agent writes setup/migrations/deploy, app-agent adds UI notes), `package.json` (anyone may add deps; if `pnpm` fails because another install is running, wait and retry).

Need a change in a file you don't own? Message its owner. Don't edit it yourself.

## Rules for working in one folder
- Read `AGENTS.md`: this Next.js version differs from training data. Check `node_modules/next/dist/docs/` before writing Next.js code.
- Commit your own work often, staging explicit paths only (`git add <your paths>`), never `git add -A`. If `index.lock` exists, wait and retry.
- One `next dev` at a time, on port 3000. Check whether http://localhost:3000 responds before starting one, and never kill a server you didn't start.
- `driveeasy_dev` is for development and seed data. `driveeasy_test` is for automated tests (QA may reset it).
- **No cloud accounts, logins or deploys.** Cloud-only work (Vercel, Neon, Blob, real payment provider) is coded behind the existing interfaces and marked BLOCKED in TASKS.md until the user provides links.

## Domain decisions
- Currency AED. Money is an integer number of fils (1 AED = 100 fils), stored as `integer`/`bigint`, never float. Format only in the UI.
- Timestamps are stored as `timestamptz` in UTC. Each branch has an IANA `time_zone` (default `Asia/Dubai`); the UI shows times in the branch's local time.
- Rental periods are `tstzrange` with `[)` bounds, so a rental ending at 10:00 and the next starting at 10:00 do not overlap.
- Primary keys are UUIDs (`gen_random_uuid()`).
- Vehicle status: `AVAILABLE | RESERVED | ON_RENT | MAINTENANCE | RETIRED`.
- Reservation status: `PENDING | CONFIRMED | PICKED_UP | RETURNED | CANCELLED | EXPIRED | REFUNDED`.
- Payment status and deposit status are separate columns/tables from reservation status.
- No overlaps: an exclusion constraint (btree_gist) guarantees a vehicle never has two overlapping *blocking* periods. Blocking = reservations in PENDING (hold not expired), CONFIRMED or PICKED_UP, plus maintenance blocks. An exclusion constraint can't span two tables, so db-agent must make both kinds of period land in one constrained table (or an equivalent design), and document it.
- Holds: a PENDING reservation holds the car for `HOLD_TTL_MINUTES` (default 15). Expired holds become EXPIRED via the idempotent release job/endpoint, and the reserve transaction also expires stale holds for that vehicle before checking.
- Pricing is computed only on the server: days = ceil(duration / 24h), minimum 1; daily rate from pricing rules; extras (per day or per rental); one-way fee when return branch ≠ pick-up branch; VAT 5% on rental + extras + fees; refundable security deposit per category (not taxed, held not charged); late return = each started hour past a 59-minute grace period at 1/24 of the daily rate, capped at one extra day per 24h.
- Default cancellation policy: free until 48h before pick-up; within 48h a fee of one day's rate; no cancellation after pick-up. Modify dates = reprice + re-check availability in one transaction.
- Roles: `customer` and `admin`. Admin pages and admin server actions check the role on the server.
- Licence uploads and damage photos are private. They are served only via an authorised route to the owner and admins. Vehicle photos are public.
- Secrets (database URL, payment keys, webhook and cron secrets) live only in server code (`src/server/**`, route handlers, server actions). Never under a `"use client"` module or a `NEXT_PUBLIC_` variable.

## Server API contract (db-agent provides, app-agent calls)
db-agent publishes typed functions under `src/server/**` and lists their signatures in this section as they land. app-agent calls them from server components and server actions. Raw SQL stays out of `src/app`.

<!-- db-agent: list functions here -->

## Change log

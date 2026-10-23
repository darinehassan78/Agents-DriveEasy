# DriveEasy team contract

Shared decisions for the three agents. Change this file only by agreement
(message the other agents) and note the change at the bottom.

## Team
| Name | Role | Owns (only this agent edits) |
|---|---|---|
| `db-agent` | Database Engine | `src/server/db/**`, `drizzle/**`, `src/server/reservations/**`, `src/server/pricing/**`, `src/server/payments/**`, `src/server/jobs/**`, `src/server/auth/**`, `src/server/catalog/**`, `src/server/customers/**`, `src/server/admin/**`, `src/server/audit/**`, `src/server/env.ts`, `src/server/errors.ts`, `src/server/log.ts`, `src/app/api/auth/**`, `src/app/api/cron/**`, `src/app/api/webhooks/**`, `scripts/**`, `vercel.json` |
| `app-agent` | App / UI | `src/app/**` (except the API routes above), `src/components/**`, `src/lib/**`, `src/server/storage/**`, `public/**` |
| `qa-agent` | QA | `e2e/**`, `tests/**`, `docs/BUGS.md` |

Shared: `TASKS.md` (everyone), `README.md` (db-agent writes setup/migrations/deploy, app-agent adds UI notes), `package.json` (anyone may add deps; if `pnpm` fails because another install is running, wait and retry).

Need a change in a file you don't own? Message its owner. Don't edit it yourself.

## Rules for working in one folder
- Read `AGENTS.md`: this Next.js version differs from training data. Check `node_modules/next/dist/docs/` before writing Next.js code.
- Commit your own work often, staging explicit paths only (`git add <your paths>`), never `git add -A`. If `index.lock` exists, wait and retry.
- One `next dev` at a time, on port 3300. Check whether http://localhost:3300 responds before starting one, and never kill a server you didn't start.
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

All functions are server-only. Money is integer **fils**, times are `Date` (UTC). Errors are `DomainError` (`src/server/errors.ts`) with a `code` (`VALIDATION | NOT_FOUND | FORBIDDEN | UNAUTHENTICATED | NOT_AVAILABLE | HOLD_EXPIRED | INVALID_STATE | POLICY | PAYMENT_FAILED | CONFLICT`) and a `message` that is safe to show to the user. `ActingUser = { id: string; role: "customer" | "admin" }` (the `CurrentUser` from auth fits). Functions that take a `now?` let tests control the clock.

**Auth** (`@/server/auth`): `getAuth()` (Better Auth instance, `/api/auth/*` via `src/app/api/auth/[...all]/route.ts`). `getCurrentUser(): Promise<CurrentUser | null>`, `requireUser()`, `requireAdmin()`, where `CurrentUser = { id, name, email, role }`. Clients use `createAuthClient()` from `better-auth/react`. The role can't be set by clients; new sign-ups are `customer`.

**Catalog** (`@/server/catalog`, public reads): `listBranches({includeInactive?})`, `getBranch(idOrCode)`, `listCategories()`, `listExtras({includeInactive?})`, `listFeatures()`, `getVehicle(id): VehicleDetails | null` (with `branch`, `category`, `features`).
- `searchAvailableVehicles({ pickupBranchId, returnBranchId?, pickupAt, returnAt, categoryId?, transmission?, fuelType?, minSeats?, maxDailyRateFils?, featureCodes?, sort?: "price_asc"|"price_desc"|"seats_desc"|"name" }, now?)` returns `SearchResult[]` = `{ vehicle: VehicleDetails, days, dailyRateFils, rentalFils, oneWayFeeFils, vatFils, estimatedTotalFils, depositFils }`.
- `getVehicleAvailability(vehicleId, from, to, now?)` returns `{ vehicleId, timeZone, blocks: {start, end, kind: "reservation"|"maintenance"}[], days: {date: "YYYY-MM-DD", available}[] }`, with no customer data.

**Pricing** (`@/server/pricing`): `quote({ vehicleId, pickupBranchId, returnBranchId, pickupAt, returnAt, extras: [{extraId?|code?, quantity}] }): Quote` = `{ days, dailyRateFils, rentalFils, extras: ExtraLine[], extrasFils, oneWayFeeFils, subtotalFils, vatRateBps, vatFils, totalFils, depositFils, ... }`. Pure helpers: `rentalDays`, `computeQuote`, `computeLateFee`, `cancellationQuote`, `vatOn`, `localDate`.

**Customer** (`@/server/customers`): `getDriverProfile(userId)`, `upsertDriverProfile(userId, {fullName, phone, dateOfBirth: "YYYY-MM-DD", nationality?, licenceNumber, licenceCountry, licenceExpiry: "YYYY-MM-DD", licenceFileKey?}, now?)`. It checks age 21+ and that the licence hasn't expired. `licenceFileKey` must start with `licences/<userId>/`. `getFileOwner(key)` returns `{userId|null, kind}` (damage keys are admin-only).

**Reservations** (`@/server/reservations`):
- `reserve({ userId, idempotencyKey, vehicleId, pickupBranchId, returnBranchId, pickupAt, returnAt, extras, driver? }, {now?})` returns `{ reservationId, reference, status: "PENDING", holdExpiresAt, quote, replayed }`. Throws `NOT_AVAILABLE` when another booking won the car. `driver` defaults to the saved profile. Reusing the same `idempotencyKey` returns the same booking.
- `getReservationForUser(idOrReference, userId)`, `getReservationAdmin(idOrReference)`, `listMyReservations(userId)`, `listReservations(filters)` (admin). All return `ReservationDetails`: status, paymentStatus, depositStatus, every money field plus `paidFils`/`refundedFils`, `driver`, `vehicle {make, model, year, plate, photoUrls, categoryName...}`, `pickupBranch`/`returnBranch {name, address, phone, timeZone, openingHours}`, `extras[]`, `agreement | null`, `payments[]`, `deposit`, and `customer` on admin reads only.
- `quoteCancellation(id, user, now?)` returns `{ allowed, reason, feeFils, refundFils, paidFils }`. `cancelReservation(id, user, {reason?, waiveFee? (admin), now?})` returns `{ status, feeFils, refundFils, refundedFils, depositReleased }`.
- `quoteModification(id, user, {pickupAt, returnAt}, now?)` returns `{ allowed, reason, available, current, quote, differenceFils }`. `modifyReservationDates(id, user, {pickupAt, returnAt}, {now?, fakeOutcome?})` returns `{ status, pickupAt, returnAt, totalFils, differenceFils, paymentFailed? }`.

**Payments** (`@/server/payments/service`):
- `startCheckout(reservationId, user, { fakeOutcome?, depositFakeOutcome?: "succeed"|"fail"|"requires_action", now? })` returns `{ outcome: "CONFIRMED"|"REQUIRES_ACTION"|"FAILED"|"PENDING", reference, reservationStatus, paymentStatus, depositStatus, step?, clientSecret?, message }`. It holds the deposit, then charges, and confirms only on verified results. Safe to call again: a retry never double charges. After FAILED you can retry while the hold lasts; after the hold expires it throws `HOLD_EXPIRED`.
- `handlePaymentWebhook(rawBody, signature)` (used by `POST /api/webhooks/payments`).
- Admin: `adminRefund(reservationId, admin, {amountFils?, reason, requestId})`.

**Operations / admin** (`@/server/admin`, all take the admin `ActingUser` first and re-check the role):
- `createBranch`, `updateBranch`, `createCategory`, `updateCategory`, `createVehicle` (with `featureCodes`), `updateVehicle`, `setVehicleStatus(admin, id, status)`, `listFleet(filters)`.
- `listPricingRules`, `createPricingRule`, `updatePricingRule`, `deletePricingRule`, `createExtra`, `updateExtra`.
- `createMaintenanceBlock(admin, {vehicleId, startsAt, endsAt, reason})` (throws `NOT_AVAILABLE` if it overlaps a booking), `deleteMaintenanceBlock`, `listMaintenanceBlocks`.
- `listUsers`, `setUserRole`, `listAuditLogs`.
- `adminReleaseDeposit(admin, reservationId)`, `adminCaptureDeposit(admin, reservationId, amountFils, reason)`.
- Re-exported from reservations: `listReservations`, `getReservationAdmin`, `cancelReservation`, `checkOut(reservationId, admin, {mileageKm, fuelPct, notes?}, {now?})`, `checkIn(reservationId, admin, {mileageKm, fuelPct, notes?, damageChargeFils?, settleDeposit?}, {now?})`. `checkIn` returns `{ lateFee {lateHours, feeFils, vatFils, totalFils}, chargesFils, capturedFromDepositFils, chargedToCardFils, depositStatus, distanceKm }`.
- Also re-exported: `previewLateFee(reservationId, at?)`, `createDamageReport(admin, {reservationId?|vehicleId?, stage, severity, description, photoKeys[], estimatedCostFils?})`, `updateDamageReport`, `chargeDamage(admin, reportId, amountFils)`, `listDamageReports(filters)`, `getDamageReport(id)`.

**Jobs / routes**:
- `releaseExpiredHolds(now?)` (`@/server/jobs/release-expired-holds`). Also `pnpm jobs:release-expired-holds`, and `GET|POST /api/cron/release-expired-holds` with `Authorization: Bearer $CRON_SECRET`.
- Payment webhooks: `POST /api/webhooks/payments`.

**Seed accounts** (`pnpm db:seed`): `admin@driveeasy.test` / `DriveEasy-Admin-1`, `customer@driveeasy.test` / `DriveEasy-Customer-1`, `customer2@driveeasy.test` / `DriveEasy-Customer-2`. Vehicle photos point to `/images/vehicles/<category>.svg`; app-agent provides these files (economy, compact, suv, luxury, van).

## Change log
- db-agent: published the Server API contract. db-agent now also owns the new server modules (catalog, customers, admin, audit, errors, log), env.ts, and `src/app/api/auth/**` (agreed with app-agent).

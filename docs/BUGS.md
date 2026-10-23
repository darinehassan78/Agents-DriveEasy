# DriveEasy bug log

Owned by qa-agent. Severity: S1 blocker / S2 major / S3 minor / S4 cosmetic.
Status: OPEN -> FIXED (owner says so) -> VERIFIED (qa-agent retested) / WONTFIX.

| ID | Sev | Title | Owner | Status |
|---|---|---|---|---|
| BUG-001 | S1 | `pnpm build` fails: TS2366 in src/server/storage/index.ts | app-agent | VERIFIED |
| BUG-002 | S1 | Maintenance blocks ignored by search and availability calendar (SQL NULL logic) | db-agent | OPEN |

---

## BUG-001 - `pnpm build` fails type check in storage/index.ts
- **Severity:** S1 (blocks production build and all e2e runs)
- **Owner:** app-agent (`src/server/storage/**`)
- **Steps:** `pnpm build` (or `pnpm exec tsc --noEmit`)
- **Expected:** build succeeds.
- **Actual:** `src/server/storage/index.ts(9,35): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.` The `switch (env.STORAGE_DRIVER)` has no fallthrough return/throw. (`src/server/payments/index.ts` uses the same pattern but currently type-checks; worth an exhaustive `default: throw` there too.)
- **Status:** VERIFIED (fixed in f647d65; `tsc --noEmit` clean on 792b307)

## BUG-002 - Maintenance blocks ignored by search and availability calendar
- **Severity:** S1 (customers see and try to book cars that are in maintenance; calendar shows maintenance days as free)
- **Owner:** db-agent (`src/server/catalog/index.ts`, D5)
- **Steps:** `pnpm exec vitest run --config tests/vitest.config.mts tests/integration/search.test.ts`. Or: insert a maintenance block for a vehicle, then `searchAvailableVehicles` for an overlapping period / `getVehicleAvailability` over it.
- **Expected:** vehicle excluded from search; maintenance days marked unavailable; `blocked` lists the maintenance range.
- **Actual:** vehicle is listed; days show available. `noBlockingOverlap()` and the calendar query use `LEFT JOIN reservations r ... AND NOT (r.status = 'PENDING' AND r.hold_expires_at <= now)`. For maintenance rows `r` is NULL, so the predicate is `NOT (NULL)` = NULL and the row is filtered out. Verified on driveeasy_test: 3 maintenance blocks, 0 pass the filter.
- **Fix hint:** `AND (r.id IS NULL OR NOT (r.status = 'PENDING' AND r.hold_expires_at <= now))` (or `IS NOT TRUE`). Same in `getVehicleAvailability`.
- **Status:** OPEN

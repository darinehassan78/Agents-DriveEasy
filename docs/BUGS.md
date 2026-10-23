# DriveEasy bug log

Owned by qa-agent. Severity: S1 blocker / S2 major / S3 minor / S4 cosmetic.
Status: OPEN -> FIXED (owner says so) -> VERIFIED (qa-agent retested) / WONTFIX.

| ID | Sev | Title | Owner | Status |
|---|---|---|---|---|
| BUG-001 | S1 | `pnpm build` fails: TS2366 in src/server/storage/index.ts | app-agent | VERIFIED |

---

## BUG-001 - `pnpm build` fails type check in storage/index.ts
- **Severity:** S1 (blocks production build and all e2e runs)
- **Owner:** app-agent (`src/server/storage/**`)
- **Steps:** `pnpm build` (or `pnpm exec tsc --noEmit`)
- **Expected:** build succeeds.
- **Actual:** `src/server/storage/index.ts(9,35): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.` The `switch (env.STORAGE_DRIVER)` has no fallthrough return/throw. (`src/server/payments/index.ts` uses the same pattern but currently type-checks; worth an exhaustive `default: throw` there too.)
- **Status:** VERIFIED (fixed in f647d65; `tsc --noEmit` clean on 792b307)

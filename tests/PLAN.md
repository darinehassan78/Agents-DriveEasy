# DriveEasy test plan (qa-agent)

Everything runs locally against PostgreSQL 18 (`driveeasy_test`), the fake payment
provider and local file storage. No cloud accounts. Vercel tests are BLOCKED (X4).

## Layers and commands

| Layer | Tool | Location | Command |
|---|---|---|---|
| Unit (owned by feature agents) | Vitest | `src/**/*.test.ts` | `pnpm test` |
| Integration (real DB, server modules, route handlers) | Vitest | `tests/integration/**` | `pnpm test:integration` |
| End to end (browser) | Playwright | `e2e/**` | `pnpm test:e2e` |
| Reset test DB by hand | tsx | `tests/support/reset-db.mts` | `pnpm test:db:reset` |

### Harness
- `tests/support/env.ts` loads `.env.local`, sets `DATABASE_URL=TEST_DATABASE_URL`, and
  refuses any database whose name does not end in `_test`.
- `tests/support/db.ts` `resetTestDatabase()` drops the `public` and `drizzle` schemas,
  recreates `public`, installs `btree_gist`, runs every migration in `./drizzle` with the
  drizzle migrator and calls `seed(pool, { now })` from `src/server/db/seed.ts`.
  Helpers: `testPool()`, `q()`, `one()`, `clients(n)` (separate connections), `tableExists()`.
- Vitest integration: `tests/vitest.config.mts`, global setup resets once, files run serially
  (one shared DB). Tests that need special data create it themselves (unique emails / plates).
- Playwright: `playwright.config.ts` starts `pnpm test:db:reset && pnpm build && pnpm start -p 3100`
  with `DATABASE_URL`=test DB and URLs on :3100, so it never touches the shared `next dev`
  on :3300 or `driveeasy_dev`. `E2E_SKIP_BUILD=1` reuses the last build, `E2E_BASE_URL`
  targets an already running test server. `reuseExistingServer` is on locally.
- Projects: `chromium` (all), `firefox` + `webkit` (tests tagged `@cross-browser`),
  `mobile-chrome` (Pixel 7) + `mobile-safari` (iPhone 14) (tests tagged `@mobile`).
- Time-dependent rules (holds, late return, cancellation window) are tested at integration
  level by passing `now` to server functions, or by moving DB timestamps backwards.

## Requirement -> tests

IDs: `I-` integration (Vitest), `E-` end to end (Playwright).

### Q2 Auth and authorisation
| Requirement | Tests |
|---|---|
| Register with email + password; duplicate email rejected; weak password rejected | E-auth `register`, I-auth `duplicate email` |
| Login, wrong password rejected, logout clears session | E-auth `login/logout` |
| Protected pages redirect anonymous users to login (rentals, checkout, profile, admin) | E-auth `anonymous redirects` |
| Customer cannot open admin pages or call admin server actions / routes (fleet, pricing, check-out/in, damage) | E-auth `customer forbidden admin`, I-authz `admin actions check role` |
| Admin can manage fleet, pricing, check-out, check-in, damage reports | E-admin `fleet/pricing/checkin/damage` |

### Q3 Search
| Requirement | Tests |
|---|---|
| Branch selection (pick-up / return), date + time range | E-search `branch + dates` |
| Invalid ranges rejected: return before pick-up, pick-up in the past | E-search `invalid ranges`, I-search |
| Filters: category, transmission, seats, fuel, price | E-search `filters`, I-search `filters` |
| Vehicles with a blocking reservation/maintenance in range are excluded; others included; boundary `[)` | I-search `availability boundaries` |
| Availability calendar on vehicle page shows booked/maintenance days | E-search `calendar`, I-search `calendar query` |

### Q4 Full rental (E2E, chromium + @cross-browser + @mobile)
search -> vehicle -> extras -> price breakdown -> driver details + licence upload -> checkout ->
fake payment -> CONFIRMED -> voucher (reference + QR image) -> admin check-out (mileage, fuel)
-> PICKED_UP -> admin check-in (mileage, fuel, damage) -> RETURNED, deposit released / captured.
DB assertions on each status step.

### Q5 Concurrency
| Requirement | Tests |
|---|---|
| Two connections reserve same vehicle, overlapping dates, same moment: exactly one succeeds | I-concurrency `Promise.all reserve` x50 iterations |
| Raw-SQL guard: two transactions inserting overlapping blocking periods -> exclusion violation (23P01) for one | I-concurrency `exclusion constraint` x50 |
| N-way race (10 concurrent) -> exactly one | I-concurrency `10-way race` |
| Two browser contexts (two users) book same car/dates at once -> one confirmed, other gets an "unavailable" message | E-concurrency (chromium) x5 |

### Q6 Boundaries and holds
| Requirement | Tests |
|---|---|
| Rental A ends 10:00, rental B starts 10:00 same vehicle: both succeed | I-overlap `back-to-back` |
| Overlap by 1 minute rejected | I-overlap `1 minute overlap` |
| Maintenance block overlapping a reservation (both directions) rejected; adjacent allowed | I-overlap `maintenance` |
| Cancelled / expired / returned reservations do not block | I-overlap `non-blocking statuses` |
| Stale hold expired inside reserve transaction | I-holds `reserve expires stale hold` |
| `pnpm jobs:release-expired-holds` expires stale PENDING, leaves fresh ones; rerun idempotent | I-holds `job command` |
| Cron endpoint: missing / bad `CRON_SECRET` -> 401; good -> 200; repeat idempotent | I-holds `cron route` (route handler called directly) + E-cron (HTTP) |

### Q7 Pricing (server only)
| Requirement | Tests |
|---|---|
| days = ceil(duration/24h), min 1 (1h -> 1, 24h -> 1, 24h01m -> 2) | I-pricing `day rounding` |
| Daily rate from pricing rules (category, branch/season if present) | I-pricing `daily rate` |
| Extras per day vs per rental | I-pricing `extras` |
| One-way fee only when return branch differs | I-pricing `one-way` |
| VAT 5% on rental + extras + fees, integer fils, rounding rule | I-pricing `vat` |
| Deposit per category, not taxed, not in total charged | I-pricing `deposit` |
| Late return: grace 59 min free; each started hour at 1/24 of daily rate; capped at one day per 24h | I-pricing `late return` |
| Client cannot tamper with price (price posted from browser ignored) | E-checkout `tamper` |

### Q8 Payments (fake provider)
| Requirement | Tests |
|---|---|
| Success -> payment succeeded + deposit held -> reservation CONFIRMED | I-payments `success` |
| Failure -> reservation stays PENDING/unconfirmed, can retry | I-payments `failure + retry` |
| Cancellation -> reservation not confirmed / CANCELLED | I-payments `cancel` |
| Retry with same idempotency key -> one reservation, one payment | I-payments `idempotency` |
| Refund on cancellation per policy (free >48h, 1 day fee within 48h, none after pick-up) | I-payments `refund policy` |
| Deposit hold / release on clean return / capture on damage | I-payments `deposit` |
| Duplicate webhook delivery processed once | I-webhooks `duplicate` |
| Bad / missing signature -> 400/401, no state change | I-webhooks `bad signature` |

### Q9 Cross-user access
| Requirement | Tests |
|---|---|
| User B cannot view A's reservation page, voucher, modify/cancel A's reservation | E-access `pages`, I-access `server functions take user id` |
| User B gets 403/404 for A's licence file via the private file route; anonymous too | E-access `file route` |
| Admin can read licence/damage files | E-access `admin file` |
| Licence files not under `/public` and not reachable by guessing `/uploads/...` | E-access `no public path`, I-access `storage dir outside public` |

### Q10 Migrations and build
| Requirement | Tests |
|---|---|
| Migrations apply on a clean DB; migration count matches journal; second run no-op | I-migrations |
| Schema objects present: tables, FKs, unique plate/VIN/branch code, exclusion constraint, btree_gist | I-migrations `schema` |
| `pnpm build` succeeds and `pnpm start` serves `/` | run by the e2e web server; recorded in report |

### Q11 Layout
| Requirement | Tests |
|---|---|
| No horizontal scroll at 375px and 1280px on key pages | E-layout `@mobile` (scrollWidth <= clientWidth) |
| Key flows usable at phone width (navigation menu, search, booking) | E-rental `@mobile` |

## Out of scope / BLOCKED
- X4 deployed preview + production tests: BLOCKED until the user provides Vercel links.
- Real Stripe and S3/Blob adapters: only verified through the shared interfaces.

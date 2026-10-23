# DriveEasy shared task list

Status: TODO / DOING / DONE / BLOCKED. Put your name on a task when you start it.
Add tasks you discover. Bugs go in `docs/BUGS.md` and get a task here.

## Database Engine (db-agent)
- [ ] D1 Schema + migrations: users (Better Auth compatible), driver_profiles, branches, vehicle_categories, vehicles, vehicle_features, vehicle_feature_map, pricing_rules, extras, reservations, reservation_extras, payments, deposits, rental_agreements, damage_reports, maintenance_blocks, audit_logs. FKs, checks, indexes, cascades, unique plate/VIN/branch code.
- [ ] D2 Overlap exclusion constraint covering reservations + maintenance blocks (see docs/TEAM.md)
- [ ] D3 Better Auth server config (email + password, roles) on the Drizzle schema
- [ ] D4 Pricing engine (rates, days, extras, one-way fee, VAT, deposit, late return) + unit tests
- [ ] D5 Availability search + per-vehicle availability calendar queries
- [ ] D6 Reserve transaction (lock vehicle, expire stale holds, check, hold, price, create PENDING), idempotency keys
- [ ] D7 Payment + deposit flow: confirm only after verified payment and deposit hold; webhook route with signature check and dedupe; refund, deposit release/capture
- [ ] D8 Modify dates / cancel per policy (transactional)
- [ ] D9 Check-out / check-in: rental agreement with mileage + fuel, late charges, damage reports
- [ ] D10 Idempotent release-expired-holds endpoint protected by CRON_SECRET + local command + vercel.json cron
- [ ] D11 Seed data: branches, categories, vehicles, features, extras, pricing rules, future reservations, admin + customer users
- [ ] D12 Audit logs for admin and reservation state changes; structured server logs
- [ ] D13 Real-provider adapters behind interfaces: Stripe (test mode), Vercel Blob storage (coordinate with app-agent). Settings-only switch.
- [ ] D14 README: local setup, env vars, migrations, testing, Vercel deployment

## App (app-agent)
- [ ] A1 Design system, layout, navigation, responsive shell, loading/error/empty states
- [ ] A2 Login / register / logout / profile (incl. driver details + licence upload)
- [ ] A3 Home with search (pick-up/return branch, dates and times)
- [ ] A4 Search results with filters (category, transmission, seats, fuel, price)
- [ ] A5 Vehicle details with availability calendar; branch pages
- [ ] A6 Booking flow: dates, extras, price breakdown, driver details + licence, checkout, payment
- [ ] A7 Pick-up voucher with reference + QR code
- [ ] A8 My rentals: view, modify dates, cancel per policy
- [ ] A9 Admin: branches, fleet, pricing, reservations, check-out, check-in, damage reports
- [ ] A10 Private file route for licence/damage images (owner + admin only); storage driver for Vercel Blob
- [ ] A11 Mobile + desktop polish, accessibility pass

## QA (qa-agent)
- [ ] Q1 Test plan + harness (test DB reset, seeding, helpers)
- [ ] Q2 Auth: register, login, logout, authorisation, admin permissions
- [ ] Q3 Search, branches, date ranges, filters, availability calendars
- [ ] Q4 Full rental: search → payment → voucher → check-out → return
- [ ] Q5 Concurrency: two sessions reserve overlapping dates at once, exactly one succeeds
- [ ] Q6 Back-to-back rentals; expired holds and automatic release
- [ ] Q7 Pricing: daily rates, extras, one-way fee, VAT, late return, deposit
- [ ] Q8 Payments: success, failure, cancel, retry, refund, deposit release, duplicate webhooks
- [ ] Q9 Cross-user access: reservations, vouchers, licence uploads
- [ ] Q10 Migrations on a clean database; production build (`pnpm build`)
- [ ] Q11 Desktop + mobile layouts (Playwright mobile project)

## Deployment (BLOCKED until the user provides cloud links)
- [ ] X1 Vercel project, preview + production environments — BLOCKED
- [ ] X2 Neon via Vercel Marketplace, pooled DATABASE_URL, migrations during deploy — BLOCKED
- [ ] X3 Vercel Blob, payment test keys, webhook secret, CRON_SECRET in Vercel — BLOCKED
- [ ] X4 End-to-end test of deployed preview + production — BLOCKED

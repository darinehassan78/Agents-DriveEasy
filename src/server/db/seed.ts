// Deterministic demo/test data. `seed(pool)` wipes every application table in
// the target database and inserts branches, categories, ~20 vehicles, features,
// extras, pricing rules, users, maintenance and future reservations.
// IDs are stable (derived from names) and dates are relative to `now`.
//
// Local accounts (documented in README and docs/TEAM.md):
//   admin@driveeasy.test      / DriveEasy-Admin-1    (admin)
//   customer@driveeasy.test   / DriveEasy-Customer-1 (customer, has bookings)
//   customer2@driveeasy.test  / DriveEasy-Customer-2 (customer, no bookings)
import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { computeQuote, DAY_MS, HOUR_MS, type ExtraInput } from "../pricing/engine";
import * as s from "./schema";

export const SEED_PASSWORDS = {
  admin: { email: "admin@driveeasy.test", password: "DriveEasy-Admin-1" },
  customer: { email: "customer@driveeasy.test", password: "DriveEasy-Customer-1" },
  customer2: { email: "customer2@driveeasy.test", password: "DriveEasy-Customer-2" },
} as const;

/** Stable UUID (v5-style layout) derived from a name, so seeded IDs never change. */
export function seedId(name: string): string {
  const h = createHash("sha1").update(`driveeasy:${name}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface SeedOptions {
  now?: Date;
  log?: (msg: string) => void;
}

export interface SeedResult {
  branches: number;
  vehicles: number;
  users: number;
  reservations: number;
}

const BRANCHES = [
  { code: "DXB", name: "Dubai Airport (DXB) Terminal 3", city: "Dubai", emirate: "Dubai", address: "Arrivals Hall, Terminal 3, Dubai International Airport", phone: "+971 4 000 0101", lat: 25.2528, lng: 55.3644, airport: true, hours: "24h", fee: 15000 },
  { code: "DMR", name: "Dubai Marina", city: "Dubai", emirate: "Dubai", address: "Marina Walk, Dubai Marina", phone: "+971 4 000 0102", lat: 25.0805, lng: 55.1403, airport: false, hours: "08:00-22:00", fee: 15000 },
  { code: "DDT", name: "Downtown Dubai", city: "Dubai", emirate: "Dubai", address: "Sheikh Mohammed bin Rashid Blvd, Downtown Dubai", phone: "+971 4 000 0103", lat: 25.1972, lng: 55.2744, airport: false, hours: "08:00-22:00", fee: 15000 },
  { code: "AUH", name: "Abu Dhabi City", city: "Abu Dhabi", emirate: "Abu Dhabi", address: "Corniche Road West, Abu Dhabi", phone: "+971 2 000 0104", lat: 24.4764, lng: 54.3705, airport: false, hours: "08:00-21:00", fee: 25000 },
  { code: "SHJ", name: "Sharjah City Centre", city: "Sharjah", emirate: "Sharjah", address: "Al Wahda Street, Sharjah", phone: "+971 6 000 0105", lat: 25.3253, lng: 55.3925, airport: false, hours: "09:00-21:00", fee: 20000 },
] as const;

const CATEGORIES = [
  { code: "ECONOMY", name: "Economy", description: "Small, efficient cars for city driving.", deposit: 100000, rate: 9900, weekly: 8500, order: 1 },
  { code: "COMPACT", name: "Compact", description: "Comfortable compact sedans and hatchbacks.", deposit: 150000, rate: 13900, weekly: 11900, order: 2 },
  { code: "SUV", name: "SUV", description: "Spacious SUVs for families and desert roads.", deposit: 200000, rate: 24900, weekly: 21900, order: 3 },
  { code: "LUXURY", name: "Luxury", description: "Premium sedans and sports cars.", deposit: 500000, rate: 69900, weekly: 62900, order: 4 },
  { code: "VAN", name: "Van & People Carrier", description: "Seven seats and more for groups.", deposit: 200000, rate: 29900, weekly: 26900, order: 5 },
] as const;

const FEATURES = [
  ["AC", "Air conditioning", "snowflake"],
  ["BLUETOOTH", "Bluetooth audio", "bluetooth"],
  ["CARPLAY", "Apple CarPlay / Android Auto", "smartphone"],
  ["REAR_CAMERA", "Rear camera", "camera"],
  ["CRUISE", "Cruise control", "gauge"],
  ["SUNROOF", "Sunroof", "sun"],
  ["LEATHER", "Leather seats", "armchair"],
  ["NAV", "Built-in navigation", "map"],
  ["AWD", "All-wheel drive", "mountain"],
  ["COOLED_SEATS", "Cooled seats", "wind"],
] as const;

type Cat = (typeof CATEGORIES)[number]["code"];
type Br = (typeof BRANCHES)[number]["code"];
const V: {
  branch: Br; cat: Cat; make: string; model: string; year: number; plate: string; color: string;
  trans: "AUTOMATIC" | "MANUAL"; fuel: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC"; seats: number; doors: number; luggage: number; km: number; features: string[];
}[] = [
  { branch: "DXB", cat: "ECONOMY", make: "Nissan", model: "Sunny", year: 2024, plate: "DXB-A-10231", color: "White", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 2, km: 18200, features: ["AC", "BLUETOOTH"] },
  { branch: "DXB", cat: "ECONOMY", make: "Kia", model: "Picanto", year: 2025, plate: "DXB-B-22874", color: "Red", trans: "AUTOMATIC", fuel: "PETROL", seats: 4, doors: 4, luggage: 1, km: 6400, features: ["AC", "BLUETOOTH", "CARPLAY"] },
  { branch: "DXB", cat: "COMPACT", make: "Toyota", model: "Corolla", year: 2025, plate: "DXB-C-31877", color: "Silver", trans: "AUTOMATIC", fuel: "HYBRID", seats: 5, doors: 4, luggage: 3, km: 9100, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE"] },
  { branch: "DXB", cat: "SUV", make: "Toyota", model: "Land Cruiser", year: 2024, plate: "DXB-D-48810", color: "Pearl White", trans: "AUTOMATIC", fuel: "PETROL", seats: 7, doors: 5, luggage: 5, km: 22500, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE", "AWD", "LEATHER", "COOLED_SEATS"] },
  { branch: "DXB", cat: "LUXURY", make: "Mercedes-Benz", model: "S 500", year: 2025, plate: "DXB-E-50001", color: "Obsidian Black", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 3, km: 4100, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE", "SUNROOF", "LEATHER", "NAV", "COOLED_SEATS"] },
  { branch: "DXB", cat: "VAN", make: "Toyota", model: "Previa", year: 2023, plate: "DXB-F-61290", color: "Grey", trans: "AUTOMATIC", fuel: "PETROL", seats: 8, doors: 5, luggage: 4, km: 41000, features: ["AC", "BLUETOOTH", "REAR_CAMERA"] },
  { branch: "DMR", cat: "ECONOMY", make: "Hyundai", model: "Accent", year: 2024, plate: "DXB-G-70412", color: "Blue", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 2, km: 15800, features: ["AC", "BLUETOOTH", "CARPLAY"] },
  { branch: "DMR", cat: "COMPACT", make: "Mazda", model: "3", year: 2025, plate: "DXB-H-81520", color: "Soul Red", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 2, km: 7300, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE"] },
  { branch: "DMR", cat: "LUXURY", make: "Porsche", model: "911 Carrera", year: 2024, plate: "DXB-J-91111", color: "Guards Red", trans: "AUTOMATIC", fuel: "PETROL", seats: 4, doors: 2, luggage: 1, km: 8800, features: ["AC", "BLUETOOTH", "CARPLAY", "LEATHER", "NAV"] },
  { branch: "DMR", cat: "SUV", make: "Nissan", model: "Patrol", year: 2025, plate: "DXB-K-10770", color: "Black", trans: "AUTOMATIC", fuel: "PETROL", seats: 7, doors: 5, luggage: 5, km: 3900, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "AWD", "LEATHER", "COOLED_SEATS"] },
  { branch: "DDT", cat: "COMPACT", make: "Volkswagen", model: "Golf", year: 2024, plate: "DXB-L-20915", color: "White", trans: "MANUAL", fuel: "PETROL", seats: 5, doors: 5, luggage: 2, km: 19400, features: ["AC", "BLUETOOTH", "CARPLAY"] },
  { branch: "DDT", cat: "LUXURY", make: "BMW", model: "7 Series", year: 2025, plate: "DXB-M-77007", color: "Carbon Black", trans: "AUTOMATIC", fuel: "HYBRID", seats: 5, doors: 4, luggage: 3, km: 5200, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE", "SUNROOF", "LEATHER", "NAV"] },
  { branch: "DDT", cat: "SUV", make: "Tesla", model: "Model Y", year: 2025, plate: "DXB-N-33450", color: "Midnight Silver", trans: "AUTOMATIC", fuel: "ELECTRIC", seats: 5, doors: 5, luggage: 4, km: 11200, features: ["AC", "BLUETOOTH", "REAR_CAMERA", "CRUISE", "AWD", "NAV"] },
  { branch: "AUH", cat: "ECONOMY", make: "Mitsubishi", model: "Attrage", year: 2024, plate: "AUH-1-40518", color: "Silver", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 2, km: 24600, features: ["AC", "BLUETOOTH"] },
  { branch: "AUH", cat: "COMPACT", make: "Honda", model: "Civic", year: 2025, plate: "AUH-1-51633", color: "Grey", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 3, km: 8700, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA"] },
  { branch: "AUH", cat: "SUV", make: "Lexus", model: "LX 600", year: 2024, plate: "AUH-1-62744", color: "White", trans: "AUTOMATIC", fuel: "PETROL", seats: 7, doors: 5, luggage: 5, km: 16300, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE", "AWD", "LEATHER", "SUNROOF", "COOLED_SEATS"] },
  { branch: "AUH", cat: "VAN", make: "Hyundai", model: "Staria", year: 2025, plate: "AUH-1-73855", color: "White", trans: "AUTOMATIC", fuel: "DIESEL", seats: 9, doors: 5, luggage: 5, km: 6100, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA"] },
  { branch: "SHJ", cat: "ECONOMY", make: "Toyota", model: "Yaris", year: 2024, plate: "SHJ-2-84966", color: "Red", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 2, km: 21000, features: ["AC", "BLUETOOTH"] },
  { branch: "SHJ", cat: "COMPACT", make: "Kia", model: "K5", year: 2025, plate: "SHJ-2-95077", color: "Black", trans: "AUTOMATIC", fuel: "PETROL", seats: 5, doors: 4, luggage: 3, km: 5600, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE"] },
  { branch: "SHJ", cat: "SUV", make: "Hyundai", model: "Tucson", year: 2024, plate: "SHJ-2-10188", color: "Blue", trans: "AUTOMATIC", fuel: "HYBRID", seats: 5, doors: 5, luggage: 4, km: 17900, features: ["AC", "BLUETOOTH", "CARPLAY", "REAR_CAMERA", "CRUISE"] },
  { branch: "SHJ", cat: "ECONOMY", make: "Suzuki", model: "Swift", year: 2023, plate: "SHJ-2-11299", color: "Yellow", trans: "MANUAL", fuel: "PETROL", seats: 5, doors: 5, luggage: 1, km: 38800, features: ["AC"] },
];

const EXTRAS: (Omit<ExtraInput, "id"> & { description: string; order: number })[] = [
  { code: "CHILD_SEAT", name: "Child seat", description: "Child seat (9-36 kg), fitted on request.", pricing: "PER_DAY", priceFils: 2500, maxQuantity: 3, maxChargeFils: 25000, order: 1 },
  { code: "GPS", name: "GPS navigation", description: "Portable GPS with UAE maps.", pricing: "PER_DAY", priceFils: 2000, maxQuantity: 1, maxChargeFils: 20000, order: 2 },
  { code: "ADDITIONAL_DRIVER", name: "Additional driver", description: "Add a second named driver (licence checked at pick-up).", pricing: "PER_DAY", priceFils: 3000, maxQuantity: 2, maxChargeFils: 30000, order: 3 },
  { code: "FULL_INSURANCE", name: "Full insurance", description: "Zero-excess cover for collision and theft.", pricing: "PER_DAY", priceFils: 4500, maxQuantity: 1, maxChargeFils: null, order: 4 },
  { code: "PREPAID_FUEL", name: "Prepaid full tank", description: "Return with any fuel level.", pricing: "PER_RENTAL", priceFils: 12000, maxQuantity: 1, maxChargeFils: null, order: 5 },
];

/** A 17-character VIN from the allowed alphabet, derived from the plate. */
function vinFor(plate: string): string {
  const alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  const h = createHash("sha256").update(plate).digest();
  let vin = "";
  for (let i = 0; i < 17; i++) vin += alphabet[h[i] % alphabet.length];
  return vin;
}

/** Midnight UTC of `now`'s date + `days`, plus `hour` hours in Dubai (UTC+4). */
function dubaiAt(now: Date, days: number, hour: number): Date {
  const midnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnightUtc + days * DAY_MS + (hour - 4) * HOUR_MS);
}

export async function seed(pool: Pool, opts: SeedOptions = {}): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const db = drizzle(pool, { schema: s });

  const [adminHash, customerHash, customer2Hash] = await Promise.all([
    hashPassword(SEED_PASSWORDS.admin.password),
    hashPassword(SEED_PASSWORDS.customer.password),
    hashPassword(SEED_PASSWORDS.customer2.password),
  ]);

  const result = await db.transaction(async (tx) => {
    // Wipe every application table (not drizzle's migration bookkeeping).
    const { rows } = await tx.execute<{ name: string }>(
      sql`SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'`,
    );
    if (rows.length) await tx.execute(sql.raw(`TRUNCATE ${rows.map((r) => r.name).join(", ")} CASCADE`));

    // --- Branches, categories, features, extras
    const branchId = (code: string) => seedId(`branch:${code}`);
    await tx.insert(s.branches).values(
      BRANCHES.map((b) => ({
        id: branchId(b.code),
        code: b.code,
        name: b.name,
        city: b.city,
        emirate: b.emirate,
        address: b.address,
        phone: b.phone,
        email: `${b.code.toLowerCase()}@driveeasy.test`,
        latitude: b.lat,
        longitude: b.lng,
        timeZone: "Asia/Dubai",
        openingHours: b.hours,
        isAirport: b.airport,
        oneWayFeeFils: b.fee,
      })),
    );
    const categoryId = (code: string) => seedId(`category:${code}`);
    await tx.insert(s.vehicleCategories).values(
      CATEGORIES.map((c) => ({
        id: categoryId(c.code),
        code: c.code,
        name: c.name,
        description: c.description,
        depositFils: c.deposit,
        imageUrl: `/images/vehicles/${c.code.toLowerCase()}.svg`,
        sortOrder: c.order,
      })),
    );
    const featureId = (code: string) => seedId(`feature:${code}`);
    await tx
      .insert(s.vehicleFeatures)
      .values(FEATURES.map(([code, name, icon]) => ({ id: featureId(code), code, name, icon })));
    const extraId = (code: string) => seedId(`extra:${code}`);
    await tx.insert(s.extras).values(
      EXTRAS.map((e) => ({
        id: extraId(e.code),
        code: e.code,
        name: e.name,
        description: e.description,
        pricing: e.pricing,
        priceFils: e.priceFils,
        maxQuantity: e.maxQuantity,
        maxChargeFils: e.maxChargeFils,
        sortOrder: e.order,
      })),
    );

    // --- Pricing rules: base, weekly (7+ days), year-end peak season, airport premium for luxury
    const year = now.getUTCFullYear();
    const rules: (typeof s.pricingRules.$inferInsert)[] = [];
    for (const c of CATEGORIES) {
      rules.push({ id: seedId(`rule:${c.code}:base`), name: `${c.name} standard`, categoryId: categoryId(c.code), dailyRateFils: c.rate });
      rules.push({ id: seedId(`rule:${c.code}:weekly`), name: `${c.name} weekly`, categoryId: categoryId(c.code), dailyRateFils: c.weekly, minDays: 7 });
      for (const y of [year, year + 1]) {
        rules.push({
          id: seedId(`rule:${c.code}:peak:${y}`),
          name: `${c.name} peak season ${y}/${y + 1}`,
          categoryId: categoryId(c.code),
          dailyRateFils: Math.round((c.rate * 1.3) / 100) * 100,
          validFrom: `${y}-12-20`,
          validTo: `${y + 1}-01-05`,
          priority: 10,
        });
      }
    }
    rules.push({
      id: seedId("rule:LUXURY:DXB"),
      name: "Luxury at Dubai Airport",
      categoryId: categoryId("LUXURY"),
      branchId: branchId("DXB"),
      dailyRateFils: 74900,
    });
    await tx.insert(s.pricingRules).values(rules);

    // --- Vehicles
    const vehicleId = (plate: string) => seedId(`vehicle:${plate}`);
    await tx.insert(s.vehicles).values(
      V.map((v) => ({
        id: vehicleId(v.plate),
        branchId: branchId(v.branch),
        categoryId: categoryId(v.cat),
        make: v.make,
        model: v.model,
        year: v.year,
        plate: v.plate,
        vin: vinFor(v.plate),
        color: v.color,
        transmission: v.trans,
        fuelType: v.fuel,
        seats: v.seats,
        doors: v.doors,
        luggage: v.luggage,
        mileageKm: v.km,
        photoUrls: [`/images/vehicles/${v.cat.toLowerCase()}.svg`],
        description: `${v.year} ${v.make} ${v.model} in ${v.color}.`,
      })),
    );
    await tx
      .insert(s.vehicleFeatureMap)
      .values(V.flatMap((v) => v.features.map((f) => ({ vehicleId: vehicleId(v.plate), featureId: featureId(f) }))));

    // --- Users (Better Auth credential accounts) + driver profiles
    const users = [
      { key: "admin", name: "DriveEasy Admin", role: "admin" as const, hash: adminHash },
      { key: "customer", name: "Layla Customer", role: "customer" as const, hash: customerHash },
      { key: "customer2", name: "Omar Customer", role: "customer" as const, hash: customer2Hash },
    ] as const;
    const userId = (key: string) => seedId(`user:${key}`);
    await tx.insert(s.users).values(
      users.map((u) => ({
        id: userId(u.key),
        name: u.name,
        email: SEED_PASSWORDS[u.key].email,
        emailVerified: true,
        role: u.role,
      })),
    );
    await tx.insert(s.accounts).values(
      users.map((u) => ({
        id: seedId(`account:${u.key}`),
        userId: userId(u.key),
        accountId: userId(u.key),
        providerId: "credential",
        password: u.hash,
      })),
    );
    const driver: s.DriverSnapshot = {
      fullName: "Layla Customer",
      phone: "+971 50 000 0001",
      dateOfBirth: "1990-04-12",
      nationality: "AE",
      licenceNumber: "DXB-1234567",
      licenceCountry: "AE",
      licenceExpiry: `${year + 3}-04-12`,
    };
    await tx.insert(s.driverProfiles).values([
      { id: seedId("driver:customer"), userId: userId("customer"), ...driver },
      {
        id: seedId("driver:customer2"),
        userId: userId("customer2"),
        fullName: "Omar Customer",
        phone: "+971 50 000 0002",
        dateOfBirth: "1985-09-30",
        nationality: "GB",
        licenceNumber: "GB-OMAR-85093",
        licenceCountry: "GB",
        licenceExpiry: `${year + 5}-09-30`,
      },
    ]);

    // --- Maintenance: Kia Picanto in the workshop 5-7 days from now
    await tx.insert(s.maintenanceBlocks).values({
      id: seedId("maintenance:DXB-B-22874"),
      vehicleId: vehicleId("DXB-B-22874"),
      startsAt: dubaiAt(now, 5, 8),
      endsAt: dubaiAt(now, 7, 18),
      reason: "Scheduled 10,000 km service",
      createdBy: userId("admin"),
    });

    // --- Reservations for the demo customer
    const extrasByCode = new Map(EXTRAS.map((e) => [e.code, { ...e, id: extraId(e.code) }]));
    const catOf = new Map(V.map((v) => [v.plate, CATEGORIES.find((c) => c.code === v.cat)!]));
    const branchOf = new Map(BRANCHES.map((b) => [b.code, b]));
    type Booking = {
      ref: string; plate: string; from: Br; to: Br; pickup: Date; ret: Date;
      status: "CONFIRMED" | "PICKED_UP" | "RETURNED"; extras: [string, number][];
    };
    const bookings: Booking[] = [
      { ref: "DE-SEED01", plate: "DXB-C-31877", from: "DXB", to: "DXB", pickup: dubaiAt(now, 3, 10), ret: dubaiAt(now, 6, 10), status: "CONFIRMED", extras: [["CHILD_SEAT", 1], ["FULL_INSURANCE", 1]] },
      { ref: "DE-SEED02", plate: "DXB-D-48810", from: "DXB", to: "AUH", pickup: dubaiAt(now, 10, 9), ret: dubaiAt(now, 17, 9), status: "CONFIRMED", extras: [["GPS", 1]] },
      { ref: "DE-SEED03", plate: "DXB-H-81520", from: "DMR", to: "DMR", pickup: dubaiAt(now, 1, 12), ret: dubaiAt(now, 2, 12), status: "CONFIRMED", extras: [] },
      { ref: "DE-SEED04", plate: "AUH-1-51633", from: "AUH", to: "AUH", pickup: dubaiAt(now, -1, 9), ret: dubaiAt(now, 2, 9), status: "PICKED_UP", extras: [["ADDITIONAL_DRIVER", 1]] },
      { ref: "DE-SEED05", plate: "SHJ-2-84966", from: "SHJ", to: "SHJ", pickup: dubaiAt(now, -10, 10), ret: dubaiAt(now, -7, 10), status: "RETURNED", extras: [] },
    ];
    for (const b of bookings) {
      const cat = catOf.get(b.plate)!;
      const price = computeQuote({
        pickupAt: b.pickup,
        returnAt: b.ret,
        dailyRateFils: cat.rate,
        extras: b.extras.map(([code, quantity]) => ({ extra: extrasByCode.get(code)!, quantity })),
        oneWay: b.from !== b.to,
        oneWayFeeFils: branchOf.get(b.to)!.fee,
        depositFils: cat.deposit,
      });
      const rid = seedId(`reservation:${b.ref}`);
      const vid = vehicleId(b.plate);
      const v = V.find((x) => x.plate === b.plate)!;
      const confirmedAt = new Date(b.pickup.getTime() - 2 * DAY_MS);
      await tx.insert(s.reservations).values({
        id: rid,
        reference: b.ref,
        userId: userId("customer"),
        vehicleId: vid,
        pickupBranchId: branchId(b.from),
        returnBranchId: branchId(b.to),
        pickupAt: b.pickup,
        returnAt: b.ret,
        status: b.status,
        paymentStatus: "PAID",
        depositStatus: b.status === "RETURNED" ? "RELEASED" : "HELD",
        idempotencyKey: `seed:${b.ref}`,
        driver,
        days: price.days,
        dailyRateFils: price.dailyRateFils,
        rentalFils: price.rentalFils,
        extrasFils: price.extrasFils,
        oneWayFeeFils: price.oneWayFeeFils,
        vatFils: price.vatFils,
        totalFils: price.totalFils,
        depositFils: price.depositFils,
        pricingRuleId: seedId(`rule:${cat.code}:base`),
        confirmedAt,
        pickedUpAt: b.status === "CONFIRMED" ? null : b.pickup,
        returnedAt: b.status === "RETURNED" ? b.ret : null,
        createdAt: confirmedAt,
      });
      if (price.extras.length) {
        await tx.insert(s.reservationExtras).values(
          price.extras.map((e) => ({
            reservationId: rid,
            extraId: e.extraId,
            quantity: e.quantity,
            pricing: e.pricing,
            unitPriceFils: e.unitPriceFils,
            totalFils: e.totalFils,
          })),
        );
      }
      // Seeded payments use provider "seed": they were never sent to a live
      // provider, so refunds/releases on them are recorded locally only.
      await tx.insert(s.payments).values({
        id: seedId(`payment:${b.ref}`),
        reservationId: rid,
        amountFils: price.totalFils,
        status: "SUCCEEDED",
        provider: "seed",
        providerRef: `seed_pay_${b.ref}`,
        idempotencyKey: `seed:pay:${b.ref}`,
        createdAt: confirmedAt,
      });
      await tx.insert(s.deposits).values({
        id: seedId(`deposit:${b.ref}`),
        reservationId: rid,
        amountFils: price.depositFils,
        status: b.status === "RETURNED" ? "RELEASED" : "HELD",
        provider: "seed",
        providerRef: `seed_hold_${b.ref}`,
        idempotencyKey: `seed:dep:${b.ref}`,
        heldAt: confirmedAt,
        releasedAt: b.status === "RETURNED" ? b.ret : null,
        createdAt: confirmedAt,
      });
      if (b.status !== "CONFIRMED") {
        await tx.insert(s.rentalAgreements).values({
          id: seedId(`agreement:${b.ref}`),
          reservationId: rid,
          vehicleId: vid,
          checkedOutBy: userId("admin"),
          checkedOutAt: b.pickup,
          pickupMileageKm: v.km - (b.status === "RETURNED" ? 420 : 0),
          pickupFuelPct: 100,
          ...(b.status === "RETURNED"
            ? { checkedInBy: userId("admin"), checkedInAt: b.ret, returnMileageKm: v.km, returnFuelPct: 90 }
            : {}),
        });
      }
      if (b.status === "PICKED_UP") {
        await tx.update(s.vehicles).set({ status: "ON_RENT" }).where(eq(s.vehicles.id, vid));
      }
    }

    await tx.insert(s.auditLogs).values({
      actorType: "system",
      action: "seed.completed",
      entityType: "database",
      metadata: { now: now.toISOString(), vehicles: V.length, reservations: bookings.length },
    });

    return { branches: BRANCHES.length, vehicles: V.length, users: users.length, reservations: bookings.length };
  });
  log(`seeded ${result.branches} branches, ${result.vehicles} vehicles, ${result.users} users, ${result.reservations} reservations`);
  return result;
}


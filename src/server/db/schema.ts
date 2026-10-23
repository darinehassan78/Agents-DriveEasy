// DriveEasy database schema (Drizzle). Conventions (docs/TEAM.md):
// - UUID primary keys (gen_random_uuid()), timestamptz in UTC.
// - Money is integer fils (1 AED = 100 fils), never float.
// - Rental periods are tstzrange with [) bounds.
//
// Overlap protection: an exclusion constraint cannot span two tables, so both
// reservations and maintenance blocks project their *blocking* periods into one
// table, `vehicle_blocks`, which carries
//   EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
// Triggers on `reservations` and `maintenance_blocks` keep it in sync (see the
// custom migration drizzle/0001_*.sql). A reservation blocks while its status is
// PENDING / CONFIRMED / PICKED_UP; any other status removes its block row.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --- Custom types --------------------------------------------------------------

/** PostgreSQL tstzrange, read/written as its text form, e.g. ["2026-01-01 10:00:00+00","2026-01-02 10:00:00+00"). */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid("id").primaryKey().defaultRandom();

// --- Enums ---------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const vehicleStatus = pgEnum("vehicle_status", ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);
export const reservationStatus = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "RETURNED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);
/** Summary of the rental charge on a reservation (separate from reservation status). */
export const reservationPaymentStatus = pgEnum("reservation_payment_status", [
  "UNPAID",
  "PENDING",
  "PAID",
  "FAILED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
/** Status of one payment row (a charge or a refund). */
export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "REQUIRES_ACTION",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
export const paymentKind = pgEnum("payment_kind", ["CHARGE", "REFUND"]);
export const paymentPurpose = pgEnum("payment_purpose", ["RENTAL", "MODIFICATION", "LATE_FEE", "DAMAGE", "OTHER"]);
/** Security deposit status (held, not charged). NONE = not attempted yet. */
export const depositStatus = pgEnum("deposit_status", ["NONE", "PENDING", "HELD", "RELEASED", "CAPTURED", "FAILED"]);
export const transmission = pgEnum("transmission", ["AUTOMATIC", "MANUAL"]);
export const fuelType = pgEnum("fuel_type", ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]);
export const extraPricing = pgEnum("extra_pricing", ["PER_DAY", "PER_RENTAL"]);
export const damageSeverity = pgEnum("damage_severity", ["MINOR", "MODERATE", "MAJOR"]);
export const damageStage = pgEnum("damage_stage", ["PICKUP", "RETURN", "OTHER"]);

// --- Better Auth tables (plural names; adapter uses usePlural: true) -----------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("customer"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: tz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// --- Customers -----------------------------------------------------------------

export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    nationality: text("nationality"),
    licenceNumber: text("licence_number").notNull(),
    licenceCountry: text("licence_country").notNull(),
    licenceExpiry: date("licence_expiry", { mode: "string" }).notNull(),
    /** Private storage key of the uploaded licence image (owner + admin only). */
    licenceFileKey: text("licence_file_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("driver_profiles_dob_before_expiry", sql`${t.dateOfBirth} < ${t.licenceExpiry}`)],
);

// --- Fleet ---------------------------------------------------------------------

export const branches = pgTable(
  "branches",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    emirate: text("emirate").notNull(),
    address: text("address").notNull(),
    phone: text("phone"),
    email: text("email"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    timeZone: text("time_zone").notNull().default("Asia/Dubai"),
    /** Local opening hours, e.g. "08:00-22:00" or "24h". Display only. */
    openingHours: text("opening_hours").notNull().default("08:00-22:00"),
    isAirport: boolean("is_airport").notNull().default(false),
    /** One-way drop-off fee charged when a rental is returned here from another branch. */
    oneWayFeeFils: integer("one_way_fee_fils").notNull().default(15000),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("branches_code_format", sql`${t.code} ~ '^[A-Z0-9-]{2,12}$'`),
    check("branches_one_way_fee_nonneg", sql`${t.oneWayFeeFils} >= 0`),
  ],
);

export const vehicleCategories = pgTable(
  "vehicle_categories",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Refundable security deposit held (not charged) per rental. */
    depositFils: integer("deposit_fils").notNull(),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("vehicle_categories_deposit_nonneg", sql`${t.depositFils} >= 0`)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    /** Home branch: the vehicle is rented out from here. */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "restrict" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: smallint("year").notNull(),
    plate: text("plate").notNull().unique(),
    vin: text("vin").notNull().unique(),
    color: text("color"),
    transmission: transmission("transmission").notNull(),
    fuelType: fuelType("fuel_type").notNull(),
    seats: smallint("seats").notNull(),
    doors: smallint("doors").notNull().default(4),
    luggage: smallint("luggage").notNull().default(2),
    mileageKm: integer("mileage_km").notNull().default(0),
    status: vehicleStatus("status").notNull().default("AVAILABLE"),
    /** Public photo URLs (vehicle photos are public). */
    photoUrls: text("photo_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vehicles_branch_status_idx").on(t.branchId, t.status),
    index("vehicles_category_idx").on(t.categoryId),
    check("vehicles_year_range", sql`${t.year} BETWEEN 1990 AND 2100`),
    check("vehicles_seats_range", sql`${t.seats} BETWEEN 1 AND 20`),
    check("vehicles_doors_range", sql`${t.doors} BETWEEN 2 AND 6`),
    check("vehicles_luggage_range", sql`${t.luggage} BETWEEN 0 AND 20`),
    check("vehicles_mileage_nonneg", sql`${t.mileageKm} >= 0`),
    check("vehicles_vin_format", sql`${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`),
  ],
);

export const vehicleFeatures = pgTable("vehicle_features", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon"),
});

export const vehicleFeatureMap = pgTable(
  "vehicle_feature_map",
  {
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => vehicleFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.featureId] }), index("vehicle_feature_map_feature_idx").on(t.featureId)],
);

// --- Pricing -------------------------------------------------------------------

/**
 * Daily rate rules. For a rental, the applicable rule is the active one that
 * matches the category (and the vehicle / pick-up branch if set), whose
 * [valid_from, valid_to] date window contains the pick-up date (in the branch's
 * time zone) and whose min_days <= rental days. Highest priority wins, then the
 * most specific, then the largest min_days, then the lowest rate.
 */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: id(),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    dailyRateFils: integer("daily_rate_fils").notNull(),
    minDays: integer("min_days").notNull().default(1),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pricing_rules_category_idx").on(t.categoryId, t.isActive),
    check("pricing_rules_rate_positive", sql`${t.dailyRateFils} > 0`),
    check("pricing_rules_min_days_positive", sql`${t.minDays} >= 1`),
    check(
      "pricing_rules_valid_window",
      sql`${t.validFrom} IS NULL OR ${t.validTo} IS NULL OR ${t.validFrom} <= ${t.validTo}`,
    ),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    pricing: extraPricing("pricing").notNull(),
    priceFils: integer("price_fils").notNull(),
    maxQuantity: integer("max_quantity").notNull().default(1),
    /** Optional cap per unit per rental for PER_DAY extras. */
    maxChargeFils: integer("max_charge_fils"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("extras_price_nonneg", sql`${t.priceFils} >= 0`),
    check("extras_max_quantity_positive", sql`${t.maxQuantity} >= 1`),
    check("extras_max_charge_positive", sql`${t.maxChargeFils} IS NULL OR ${t.maxChargeFils} > 0`),
  ],
);

// --- Reservations --------------------------------------------------------------

export interface DriverSnapshot {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiry: string;
  nationality?: string | null;
}

export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    /** Human-friendly booking reference, e.g. DE-7K3P9Q. */
    reference: text("reference").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickupBranchId: uuid("pickup_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    pickupAt: tz("pickup_at").notNull(),
    returnAt: tz("return_at").notNull(),
    status: reservationStatus("status").notNull().default("PENDING"),
    /** While PENDING the car is held until this time. */
    holdExpiresAt: tz("hold_expires_at"),
    paymentStatus: reservationPaymentStatus("payment_status").notNull().default("UNPAID"),
    depositStatus: depositStatus("deposit_status").notNull().default("NONE"),
    /** Client-supplied key so a retried reserve call returns the same reservation. */
    idempotencyKey: text("idempotency_key").notNull(),
    driver: jsonb("driver").$type<DriverSnapshot>().notNull(),
    currency: text("currency").notNull().default("AED"),
    days: integer("days").notNull(),
    dailyRateFils: integer("daily_rate_fils").notNull(),
    rentalFils: integer("rental_fils").notNull(),
    extrasFils: integer("extras_fils").notNull().default(0),
    oneWayFeeFils: integer("one_way_fee_fils").notNull().default(0),
    vatFils: integer("vat_fils").notNull(),
    totalFils: integer("total_fils").notNull(),
    depositFils: integer("deposit_fils").notNull(),
    pricingRuleId: uuid("pricing_rule_id").references(() => pricingRules.id, { onDelete: "set null" }),
    cancellationFeeFils: integer("cancellation_fee_fils").notNull().default(0),
    lateFeeFils: integer("late_fee_fils").notNull().default(0),
    cancellationReason: text("cancellation_reason"),
    confirmedAt: tz("confirmed_at"),
    cancelledAt: tz("cancelled_at"),
    expiredAt: tz("expired_at"),
    pickedUpAt: tz("picked_up_at"),
    returnedAt: tz("returned_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reservations_user_idempotency_uq").on(t.userId, t.idempotencyKey),
    index("reservations_user_idx").on(t.userId, t.createdAt),
    index("reservations_vehicle_idx").on(t.vehicleId, t.pickupAt),
    index("reservations_status_idx").on(t.status, t.pickupAt),
    index("reservations_pending_hold_idx")
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'PENDING'`),
    check("reservations_period_valid", sql`${t.returnAt} > ${t.pickupAt}`),
    check("reservations_pending_has_hold", sql`${t.status} <> 'PENDING' OR ${t.holdExpiresAt} IS NOT NULL`),
    check("reservations_currency", sql`${t.currency} = 'AED'`),
    check("reservations_days_positive", sql`${t.days} >= 1`),
    check(
      "reservations_amounts_nonneg",
      sql`${t.dailyRateFils} >= 0 AND ${t.rentalFils} >= 0 AND ${t.extrasFils} >= 0 AND ${t.oneWayFeeFils} >= 0 AND ${t.vatFils} >= 0 AND ${t.depositFils} >= 0 AND ${t.cancellationFeeFils} >= 0 AND ${t.lateFeeFils} >= 0`,
    ),
    check(
      "reservations_total_matches",
      sql`${t.totalFils} = ${t.rentalFils} + ${t.extrasFils} + ${t.oneWayFeeFils} + ${t.vatFils}`,
    ),
  ],
);

export const reservationExtras = pgTable(
  "reservation_extras",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id")
      .notNull()
      .references(() => extras.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    pricing: extraPricing("pricing").notNull(),
    unitPriceFils: integer("unit_price_fils").notNull(),
    totalFils: integer("total_fils").notNull(),
  },
  (t) => [
    uniqueIndex("reservation_extras_uq").on(t.reservationId, t.extraId),
    check("reservation_extras_quantity_positive", sql`${t.quantity} >= 1`),
    check("reservation_extras_amounts_nonneg", sql`${t.unitPriceFils} >= 0 AND ${t.totalFils} >= 0`),
  ],
);

// --- Payments & deposits -------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    kind: paymentKind("kind").notNull().default("CHARGE"),
    purpose: paymentPurpose("purpose").notNull().default("RENTAL"),
    /** For refunds: the charge being refunded. */
    parentPaymentId: uuid("parent_payment_id").references((): AnyPgColumn => payments.id, { onDelete: "restrict" }),
    amountFils: integer("amount_fils").notNull(),
    refundedFils: integer("refunded_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    status: paymentStatus("status").notNull().default("PENDING"),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    /** Sent to the provider; a retry with the same key cannot create a second charge. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    clientSecret: text("client_secret"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_reservation_idx").on(t.reservationId, t.createdAt),
    uniqueIndex("payments_provider_ref_uq").on(t.provider, t.providerRef),
    check("payments_amount_positive", sql`${t.amountFils} > 0`),
    check("payments_refunded_range", sql`${t.refundedFils} >= 0 AND ${t.refundedFils} <= ${t.amountFils}`),
    check("payments_currency", sql`${t.currency} = 'AED'`),
    check("payments_refund_has_parent", sql`${t.kind} = 'CHARGE' OR ${t.parentPaymentId} IS NOT NULL`),
  ],
);

export const deposits = pgTable(
  "deposits",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    amountFils: integer("amount_fils").notNull(),
    capturedFils: integer("captured_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    status: depositStatus("status").notNull().default("PENDING"),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    failureReason: text("failure_reason"),
    captureReason: text("capture_reason"),
    heldAt: tz("held_at"),
    releasedAt: tz("released_at"),
    capturedAt: tz("captured_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deposits_reservation_idx").on(t.reservationId),
    uniqueIndex("deposits_provider_ref_uq").on(t.provider, t.providerRef),
    check("deposits_amount_positive", sql`${t.amountFils} > 0`),
    check("deposits_captured_range", sql`${t.capturedFils} >= 0 AND ${t.capturedFils} <= ${t.amountFils}`),
    check("deposits_currency", sql`${t.currency} = 'AED'`),
  ],
);

/** Every provider webhook event id seen, so duplicates are ignored. */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tz("received_at").notNull().defaultNow(),
    processedAt: tz("processed_at"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);

// --- Operations ----------------------------------------------------------------

export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    checkedOutBy: uuid("checked_out_by").references(() => users.id, { onDelete: "set null" }),
    checkedOutAt: tz("checked_out_at").notNull(),
    pickupMileageKm: integer("pickup_mileage_km").notNull(),
    /** Fuel (or charge) level in percent, 0-100. */
    pickupFuelPct: smallint("pickup_fuel_pct").notNull(),
    checkedInBy: uuid("checked_in_by").references(() => users.id, { onDelete: "set null" }),
    checkedInAt: tz("checked_in_at"),
    returnMileageKm: integer("return_mileage_km"),
    returnFuelPct: smallint("return_fuel_pct"),
    lateHours: integer("late_hours").notNull().default(0),
    lateFeeFils: integer("late_fee_fils").notNull().default(0),
    lateVatFils: integer("late_vat_fils").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rental_agreements_vehicle_idx").on(t.vehicleId),
    check("rental_agreements_pickup_fuel", sql`${t.pickupFuelPct} BETWEEN 0 AND 100`),
    check("rental_agreements_return_fuel", sql`${t.returnFuelPct} IS NULL OR ${t.returnFuelPct} BETWEEN 0 AND 100`),
    check("rental_agreements_pickup_mileage", sql`${t.pickupMileageKm} >= 0`),
    check(
      "rental_agreements_return_mileage",
      sql`${t.returnMileageKm} IS NULL OR ${t.returnMileageKm} >= ${t.pickupMileageKm}`,
    ),
    check(
      "rental_agreements_checkin_complete",
      sql`(${t.checkedInAt} IS NULL) = (${t.returnMileageKm} IS NULL) AND (${t.checkedInAt} IS NULL) = (${t.returnFuelPct} IS NULL)`,
    ),
    check(
      "rental_agreements_checkin_after_checkout",
      sql`${t.checkedInAt} IS NULL OR ${t.checkedInAt} >= ${t.checkedOutAt}`,
    ),
    check("rental_agreements_late_nonneg", sql`${t.lateHours} >= 0 AND ${t.lateFeeFils} >= 0 AND ${t.lateVatFils} >= 0`),
  ],
);

export const damageReports = pgTable(
  "damage_reports",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    stage: damageStage("stage").notNull().default("OTHER"),
    severity: damageSeverity("severity").notNull(),
    description: text("description").notNull(),
    /** Private storage keys of damage photos (admin only). */
    photoKeys: text("photo_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    estimatedCostFils: integer("estimated_cost_fils"),
    chargedFils: integer("charged_fils").notNull().default(0),
    resolvedAt: tz("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("damage_reports_vehicle_idx").on(t.vehicleId, t.createdAt),
    index("damage_reports_reservation_idx").on(t.reservationId),
    check("damage_reports_description_nonempty", sql`length(trim(${t.description})) > 0`),
    check(
      "damage_reports_amounts_nonneg",
      sql`(${t.estimatedCostFils} IS NULL OR ${t.estimatedCostFils} >= 0) AND ${t.chargedFils} >= 0`,
    ),
  ],
);

export const maintenanceBlocks = pgTable(
  "maintenance_blocks",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("maintenance_blocks_vehicle_idx").on(t.vehicleId, t.startsAt),
    check("maintenance_blocks_period_valid", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/**
 * Blocking periods per vehicle (reservations PENDING/CONFIRMED/PICKED_UP and
 * maintenance). Written only by triggers; carries the exclusion constraint
 * vehicle_blocks_no_overlap (custom migration).
 */
export const vehicleBlocks = pgTable(
  "vehicle_blocks",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    period: tstzrange("period").notNull(),
    reservationId: uuid("reservation_id")
      .unique()
      .references(() => reservations.id, { onDelete: "cascade" }),
    maintenanceBlockId: uuid("maintenance_block_id")
      .unique()
      .references(() => maintenanceBlocks.id, { onDelete: "cascade" }),
  },
  (t) => [
    check("vehicle_blocks_one_source", sql`num_nonnulls(${t.reservationId}, ${t.maintenanceBlockId}) = 1`),
    check("vehicle_blocks_period_bounded", sql`NOT isempty(${t.period}) AND NOT lower_inf(${t.period}) AND NOT upper_inf(${t.period})`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** "customer" | "admin" | "system" | "provider" */
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId),
  ],
);

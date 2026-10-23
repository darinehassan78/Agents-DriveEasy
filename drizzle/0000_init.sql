CREATE TYPE "public"."damage_severity" AS ENUM('MINOR', 'MODERATE', 'MAJOR');--> statement-breakpoint
CREATE TYPE "public"."damage_stage" AS ENUM('PICKUP', 'RETURN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('NONE', 'PENDING', 'HELD', 'RELEASED', 'CAPTURED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."extra_pricing" AS ENUM('PER_DAY', 'PER_RENTAL');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('CHARGE', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('RENTAL', 'MODIFICATION', 'LATE_FEE', 'DAMAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."reservation_payment_status" AS ENUM('UNPAID', 'PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'PICKED_UP', 'RETURNED', 'CANCELLED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTOMATIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'RESERVED', 'ON_RENT', 'MAINTENANCE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"emirate" text NOT NULL,
	"address" text NOT NULL,
	"phone" text,
	"email" text,
	"latitude" double precision,
	"longitude" double precision,
	"time_zone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"opening_hours" text DEFAULT '08:00-22:00' NOT NULL,
	"is_airport" boolean DEFAULT false NOT NULL,
	"one_way_fee_fils" integer DEFAULT 15000 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_code_format" CHECK ("branches"."code" ~ '^[A-Z0-9-]{2,12}$'),
	CONSTRAINT "branches_one_way_fee_nonneg" CHECK ("branches"."one_way_fee_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reservation_id" uuid,
	"reported_by" uuid,
	"stage" "damage_stage" DEFAULT 'OTHER' NOT NULL,
	"severity" "damage_severity" NOT NULL,
	"description" text NOT NULL,
	"photo_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"estimated_cost_fils" integer,
	"charged_fils" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_reports_description_nonempty" CHECK (length(trim("damage_reports"."description")) > 0),
	CONSTRAINT "damage_reports_amounts_nonneg" CHECK (("damage_reports"."estimated_cost_fils" IS NULL OR "damage_reports"."estimated_cost_fils" >= 0) AND "damage_reports"."charged_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"amount_fils" integer NOT NULL,
	"captured_fils" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"capture_reason" text,
	"held_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deposits_amount_positive" CHECK ("deposits"."amount_fils" > 0),
	CONSTRAINT "deposits_captured_range" CHECK ("deposits"."captured_fils" >= 0 AND "deposits"."captured_fils" <= "deposits"."amount_fils"),
	CONSTRAINT "deposits_currency" CHECK ("deposits"."currency" = 'AED')
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"nationality" text,
	"licence_number" text NOT NULL,
	"licence_country" text NOT NULL,
	"licence_expiry" date NOT NULL,
	"licence_file_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "driver_profiles_dob_before_expiry" CHECK ("driver_profiles"."date_of_birth" < "driver_profiles"."licence_expiry")
);
--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pricing" "extra_pricing" NOT NULL,
	"price_fils" integer NOT NULL,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"max_charge_fils" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extras_code_unique" UNIQUE("code"),
	CONSTRAINT "extras_price_nonneg" CHECK ("extras"."price_fils" >= 0),
	CONSTRAINT "extras_max_quantity_positive" CHECK ("extras"."max_quantity" >= 1),
	CONSTRAINT "extras_max_charge_positive" CHECK ("extras"."max_charge_fils" IS NULL OR "extras"."max_charge_fils" > 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_blocks_period_valid" CHECK ("maintenance_blocks"."ends_at" > "maintenance_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_webhook_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" "payment_kind" DEFAULT 'CHARGE' NOT NULL,
	"purpose" "payment_purpose" DEFAULT 'RENTAL' NOT NULL,
	"parent_payment_id" uuid,
	"amount_fils" integer NOT NULL,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"client_secret" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_fils" > 0),
	CONSTRAINT "payments_refunded_range" CHECK ("payments"."refunded_fils" >= 0 AND "payments"."refunded_fils" <= "payments"."amount_fils"),
	CONSTRAINT "payments_currency" CHECK ("payments"."currency" = 'AED'),
	CONSTRAINT "payments_refund_has_parent" CHECK ("payments"."kind" = 'CHARGE' OR "payments"."parent_payment_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"branch_id" uuid,
	"daily_rate_fils" integer NOT NULL,
	"min_days" integer DEFAULT 1 NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_rate_positive" CHECK ("pricing_rules"."daily_rate_fils" > 0),
	CONSTRAINT "pricing_rules_min_days_positive" CHECK ("pricing_rules"."min_days" >= 1),
	CONSTRAINT "pricing_rules_valid_window" CHECK ("pricing_rules"."valid_from" IS NULL OR "pricing_rules"."valid_to" IS NULL OR "pricing_rules"."valid_from" <= "pricing_rules"."valid_to")
);
--> statement-breakpoint
CREATE TABLE "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"checked_out_by" uuid,
	"checked_out_at" timestamp with time zone NOT NULL,
	"pickup_mileage_km" integer NOT NULL,
	"pickup_fuel_pct" smallint NOT NULL,
	"checked_in_by" uuid,
	"checked_in_at" timestamp with time zone,
	"return_mileage_km" integer,
	"return_fuel_pct" smallint,
	"late_hours" integer DEFAULT 0 NOT NULL,
	"late_fee_fils" integer DEFAULT 0 NOT NULL,
	"late_vat_fils" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_agreements_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "rental_agreements_pickup_fuel" CHECK ("rental_agreements"."pickup_fuel_pct" BETWEEN 0 AND 100),
	CONSTRAINT "rental_agreements_return_fuel" CHECK ("rental_agreements"."return_fuel_pct" IS NULL OR "rental_agreements"."return_fuel_pct" BETWEEN 0 AND 100),
	CONSTRAINT "rental_agreements_pickup_mileage" CHECK ("rental_agreements"."pickup_mileage_km" >= 0),
	CONSTRAINT "rental_agreements_return_mileage" CHECK ("rental_agreements"."return_mileage_km" IS NULL OR "rental_agreements"."return_mileage_km" >= "rental_agreements"."pickup_mileage_km"),
	CONSTRAINT "rental_agreements_checkin_complete" CHECK (("rental_agreements"."checked_in_at" IS NULL) = ("rental_agreements"."return_mileage_km" IS NULL) AND ("rental_agreements"."checked_in_at" IS NULL) = ("rental_agreements"."return_fuel_pct" IS NULL)),
	CONSTRAINT "rental_agreements_checkin_after_checkout" CHECK ("rental_agreements"."checked_in_at" IS NULL OR "rental_agreements"."checked_in_at" >= "rental_agreements"."checked_out_at"),
	CONSTRAINT "rental_agreements_late_nonneg" CHECK ("rental_agreements"."late_hours" >= 0 AND "rental_agreements"."late_fee_fils" >= 0 AND "rental_agreements"."late_vat_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"extra_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"pricing" "extra_pricing" NOT NULL,
	"unit_price_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	CONSTRAINT "reservation_extras_quantity_positive" CHECK ("reservation_extras"."quantity" >= 1),
	CONSTRAINT "reservation_extras_amounts_nonneg" CHECK ("reservation_extras"."unit_price_fils" >= 0 AND "reservation_extras"."total_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"pickup_branch_id" uuid NOT NULL,
	"return_branch_id" uuid NOT NULL,
	"pickup_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"payment_status" "reservation_payment_status" DEFAULT 'UNPAID' NOT NULL,
	"deposit_status" "deposit_status" DEFAULT 'NONE' NOT NULL,
	"idempotency_key" text NOT NULL,
	"driver" jsonb NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"days" integer NOT NULL,
	"daily_rate_fils" integer NOT NULL,
	"rental_fils" integer NOT NULL,
	"extras_fils" integer DEFAULT 0 NOT NULL,
	"one_way_fee_fils" integer DEFAULT 0 NOT NULL,
	"vat_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	"deposit_fils" integer NOT NULL,
	"pricing_rule_id" uuid,
	"cancellation_fee_fils" integer DEFAULT 0 NOT NULL,
	"late_fee_fils" integer DEFAULT 0 NOT NULL,
	"cancellation_reason" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reference_unique" UNIQUE("reference"),
	CONSTRAINT "reservations_period_valid" CHECK ("reservations"."return_at" > "reservations"."pickup_at"),
	CONSTRAINT "reservations_pending_has_hold" CHECK ("reservations"."status" <> 'PENDING' OR "reservations"."hold_expires_at" IS NOT NULL),
	CONSTRAINT "reservations_currency" CHECK ("reservations"."currency" = 'AED'),
	CONSTRAINT "reservations_days_positive" CHECK ("reservations"."days" >= 1),
	CONSTRAINT "reservations_amounts_nonneg" CHECK ("reservations"."daily_rate_fils" >= 0 AND "reservations"."rental_fils" >= 0 AND "reservations"."extras_fils" >= 0 AND "reservations"."one_way_fee_fils" >= 0 AND "reservations"."vat_fils" >= 0 AND "reservations"."deposit_fils" >= 0 AND "reservations"."cancellation_fee_fils" >= 0 AND "reservations"."late_fee_fils" >= 0),
	CONSTRAINT "reservations_total_matches" CHECK ("reservations"."total_fils" = "reservations"."rental_fils" + "reservations"."extras_fils" + "reservations"."one_way_fee_fils" + "reservations"."vat_fils")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reservation_id" uuid,
	"maintenance_block_id" uuid,
	CONSTRAINT "vehicle_blocks_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "vehicle_blocks_maintenance_block_id_unique" UNIQUE("maintenance_block_id"),
	CONSTRAINT "vehicle_blocks_one_source" CHECK (num_nonnulls("vehicle_blocks"."reservation_id", "vehicle_blocks"."maintenance_block_id") = 1),
	CONSTRAINT "vehicle_blocks_period_bounded" CHECK (NOT isempty("vehicle_blocks"."period") AND NOT lower_inf("vehicle_blocks"."period") AND NOT upper_inf("vehicle_blocks"."period"))
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"deposit_fils" integer NOT NULL,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_code_unique" UNIQUE("code"),
	CONSTRAINT "vehicle_categories_deposit_nonneg" CHECK ("vehicle_categories"."deposit_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_feature_map" (
	"vehicle_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	CONSTRAINT "vehicle_feature_map_vehicle_id_feature_id_pk" PRIMARY KEY("vehicle_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	CONSTRAINT "vehicle_features_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" smallint NOT NULL,
	"plate" text NOT NULL,
	"vin" text NOT NULL,
	"color" text,
	"transmission" "transmission" NOT NULL,
	"fuel_type" "fuel_type" NOT NULL,
	"seats" smallint NOT NULL,
	"doors" smallint DEFAULT 4 NOT NULL,
	"luggage" smallint DEFAULT 2 NOT NULL,
	"mileage_km" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"photo_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin"),
	CONSTRAINT "vehicles_year_range" CHECK ("vehicles"."year" BETWEEN 1990 AND 2100),
	CONSTRAINT "vehicles_seats_range" CHECK ("vehicles"."seats" BETWEEN 1 AND 20),
	CONSTRAINT "vehicles_doors_range" CHECK ("vehicles"."doors" BETWEEN 2 AND 6),
	CONSTRAINT "vehicles_luggage_range" CHECK ("vehicles"."luggage" BETWEEN 0 AND 20),
	CONSTRAINT "vehicles_mileage_nonneg" CHECK ("vehicles"."mileage_km" >= 0),
	CONSTRAINT "vehicles_vin_format" CHECK ("vehicles"."vin" ~ '^[A-HJ-NPR-Z0-9]{17}$')
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_parent_payment_id_payments_id_fk" FOREIGN KEY ("parent_payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_out_by_users_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_extra_id_extras_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extras"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_maintenance_block_id_maintenance_blocks_id_fk" FOREIGN KEY ("maintenance_block_id") REFERENCES "public"."maintenance_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_feature_id_vehicle_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."vehicle_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "damage_reports_vehicle_idx" ON "damage_reports" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_reservation_idx" ON "damage_reports" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deposits_reservation_idx" ON "deposits" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_provider_ref_uq" ON "deposits" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "maintenance_blocks_vehicle_idx" ON "maintenance_blocks" USING btree ("vehicle_id","starts_at");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_uq" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "pricing_rules_category_idx" ON "pricing_rules" USING btree ("category_id","is_active");--> statement-breakpoint
CREATE INDEX "rental_agreements_vehicle_idx" ON "rental_agreements" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_extras_uq" ON "reservation_extras" USING btree ("reservation_id","extra_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_user_idempotency_uq" ON "reservations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_vehicle_idx" ON "reservations" USING btree ("vehicle_id","pickup_at");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status","pickup_at");--> statement-breakpoint
CREATE INDEX "reservations_pending_hold_idx" ON "reservations" USING btree ("hold_expires_at") WHERE "reservations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vehicle_feature_map_feature_idx" ON "vehicle_feature_map" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "vehicles_branch_status_idx" ON "vehicles" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "vehicles_category_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");
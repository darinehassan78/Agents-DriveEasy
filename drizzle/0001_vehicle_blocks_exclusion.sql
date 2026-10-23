-- Overlap protection (docs/TEAM.md "No overlaps").
--
-- An exclusion constraint cannot span two tables, so every *blocking* period
-- (reservations in PENDING / CONFIRMED / PICKED_UP, and maintenance blocks) is
-- projected by triggers into vehicle_blocks, which carries the constraint
--   EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
-- Periods are tstzrange '[)', so back-to-back rentals (10:00 end, 10:00 start)
-- do not overlap. A conflicting INSERT/UPDATE on reservations or
-- maintenance_blocks fails with SQLSTATE 23P01 (exclusion_violation), which the
-- application maps to a "no longer available" error.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "vehicle_blocks"
  ADD CONSTRAINT "vehicle_blocks_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION driveeasy_sync_reservation_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    INSERT INTO vehicle_blocks (vehicle_id, period, reservation_id)
    VALUES (NEW.vehicle_id, tstzrange(NEW.pickup_at, NEW.return_at, '[)'), NEW.id)
    ON CONFLICT (reservation_id) DO UPDATE
      SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period
      WHERE vehicle_blocks.vehicle_id IS DISTINCT FROM EXCLUDED.vehicle_id
         OR vehicle_blocks.period IS DISTINCT FROM EXCLUDED.period;
  ELSE
    DELETE FROM vehicle_blocks WHERE reservation_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reservations_sync_block
  AFTER INSERT OR UPDATE OF status, vehicle_id, pickup_at, return_at ON reservations
  FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_reservation_block();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION driveeasy_sync_maintenance_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO vehicle_blocks (vehicle_id, period, maintenance_block_id)
  VALUES (NEW.vehicle_id, tstzrange(NEW.starts_at, NEW.ends_at, '[)'), NEW.id)
  ON CONFLICT (maintenance_block_id) DO UPDATE
    SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period
    WHERE vehicle_blocks.vehicle_id IS DISTINCT FROM EXCLUDED.vehicle_id
       OR vehicle_blocks.period IS DISTINCT FROM EXCLUDED.period;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER maintenance_blocks_sync_block
  AFTER INSERT OR UPDATE OF vehicle_id, starts_at, ends_at ON maintenance_blocks
  FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_maintenance_block();
--> statement-breakpoint
-- Deleting a maintenance block removes its row via ON DELETE CASCADE.
CREATE INDEX IF NOT EXISTS "vehicle_blocks_period_gist" ON "vehicle_blocks" USING gist ("period");

import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { driverProfiles, reservations, users } from "../db/schema";
import { DomainError } from "../errors";
import { driverSchema, MIN_DRIVER_AGE } from "../reservations";

export type DriverProfile = typeof driverProfiles.$inferSelect;

export async function getDriverProfile(userId: string): Promise<DriverProfile | null> {
  if (!z.uuid().safeParse(userId).success) return null;
  const [row] = await db().select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  return row ?? null;
}

export const driverProfileInputSchema = driverSchema.extend({
  /** Private storage key of the uploaded licence image, e.g. "licences/<userId>/<file>". */
  licenceFileKey: z.string().min(1).max(500).nullish(),
});

export type DriverProfileInput = z.input<typeof driverProfileInputSchema>;

/** Creates or updates the user's driver profile. Validates age (21+) and licence expiry. */
export async function upsertDriverProfile(userId: string, input: DriverProfileInput, now = new Date()): Promise<DriverProfile> {
  const parsed = driverProfileInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid driver details");
  const d = parsed.data;
  const dob = new Date(`${d.dateOfBirth}T00:00:00Z`);
  const adult = new Date(Date.UTC(dob.getUTCFullYear() + MIN_DRIVER_AGE, dob.getUTCMonth(), dob.getUTCDate()));
  if (Number.isNaN(dob.getTime()) || adult.getTime() > now.getTime()) {
    throw new DomainError("VALIDATION", `Drivers must be at least ${MIN_DRIVER_AGE} years old.`);
  }
  if (new Date(`${d.licenceExpiry}T23:59:59Z`).getTime() < now.getTime()) {
    throw new DomainError("VALIDATION", "Your driving licence has expired.");
  }
  if (d.licenceFileKey && !d.licenceFileKey.startsWith(`licences/${userId}/`)) {
    throw new DomainError("VALIDATION", "Invalid licence file.");
  }
  const values = {
    userId,
    fullName: d.fullName,
    phone: d.phone,
    dateOfBirth: d.dateOfBirth,
    nationality: d.nationality ?? null,
    licenceNumber: d.licenceNumber,
    licenceCountry: d.licenceCountry,
    licenceExpiry: d.licenceExpiry,
    ...(d.licenceFileKey !== undefined ? { licenceFileKey: d.licenceFileKey } : {}),
  };
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(driverProfiles)
      .values(values)
      .onConflictDoUpdate({ target: driverProfiles.userId, set: { ...values, updatedAt: new Date() } })
      .returning();
    await audit(tx, { userId, type: "customer" }, {
      action: "driver_profile.saved",
      entityType: "driver_profile",
      entityId: row.id,
      after: { licenceCountry: row.licenceCountry, licenceExpiry: row.licenceExpiry, hasLicenceFile: !!row.licenceFileKey },
    });
    return row;
  });
}

/**
 * Who may read a private file key: the owner of a licence file, and admins.
 * Damage photos are admin-only. Returns the owning user id (null = admin-only).
 */
export async function getFileOwner(key: string): Promise<{ userId: string | null; kind: "licence" | "damage" } | null> {
  const m = /^licences\/([0-9a-f-]{36})\//.exec(key);
  if (m) {
    const [p] = await db().select({ userId: driverProfiles.userId }).from(driverProfiles).where(eq(driverProfiles.userId, m[1]));
    return p ? { userId: p.userId, kind: "licence" } : { userId: m[1], kind: "licence" };
  }
  if (key.startsWith("damage/")) return { userId: null, kind: "damage" };
  return null;
}

export async function getUser(userId: string) {
  if (!z.uuid().safeParse(userId).success) return null;
  const [row] = await db()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/** Number of bookings per user (admin customer list helper). */
export async function countReservations(userId: string): Promise<number> {
  const rows = await db().select({ id: reservations.id }).from(reservations).where(eq(reservations.userId, userId));
  return rows.length;
}

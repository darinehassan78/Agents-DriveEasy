import { auditLogs } from "../db/schema";
import type { Tx } from "../db";
import { log } from "../log";

export type ActorType = "customer" | "admin" | "system" | "provider";

export interface Actor {
  userId?: string | null;
  type: ActorType;
}

export const SYSTEM: Actor = { type: "system" };
export const PROVIDER: Actor = { type: "provider" };

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Writes an audit row in the caller's transaction and mirrors it to the structured log. */
export async function audit(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: actor.userId ?? null,
    actorType: actor.type,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before === undefined ? null : toJson(entry.before),
    after: entry.after === undefined ? null : toJson(entry.after),
    metadata: entry.metadata ?? null,
  });
  log.info("audit", {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorType: actor.type,
    actorUserId: actor.userId,
  });
}

function toJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

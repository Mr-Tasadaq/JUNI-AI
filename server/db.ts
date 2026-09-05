import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { auditEvents, InsertUser, User, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { randomUUID } from "node:crypto";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export type AdminUserSummary = Pick<
  User,
  "id" | "name" | "email" | "role" | "createdAt" | "updatedAt" | "lastSignedIn"
>;

const adminUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  lastSignedIn: users.lastSignedIn,
};

export async function listUsersForAdmin(): Promise<AdminUserSummary[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.select(adminUserColumns).from(users).orderBy(desc(users.createdAt));
}

export type RoleChangeAuditMetadata = {
  previousRole: User["role"];
  newRole: User["role"];
};

export type AdminAuditEvent = {
  id: string;
  actorUserId: number;
  action: string;
  targetUserId: number | null;
  occurredAt: Date;
  metadata: RoleChangeAuditMetadata;
};

function parseRoleChangeMetadata(value: unknown): RoleChangeAuditMetadata {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid audit metadata");
  }
  const record = value as Record<string, unknown>;
  if (
    (record.previousRole !== "user" && record.previousRole !== "admin") ||
    (record.newRole !== "user" && record.newRole !== "admin")
  ) {
    throw new Error("Invalid role-change audit metadata");
  }
  return {
    previousRole: record.previousRole,
    newRole: record.newRole,
  };
}

export async function changeUserRoleForAdmin(
  userId: number,
  role: User["role"],
  actorUserId: number
): Promise<AdminUserSummary | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const existing = await tx
      .select(adminUserColumns)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!existing[0]) return undefined;

    await tx.update(users).set({ role }).where(eq(users.id, userId));
    await tx.insert(auditEvents).values({
      id: randomUUID(),
      actorUserId,
      action: "user.role_changed",
      targetUserId: userId,
      occurredAt: new Date(),
      metadata: {
        previousRole: existing[0].role,
        newRole: role,
      },
    });

    return { ...existing[0], role };
  });
}

export async function listAuditEventsForAdmin(
  limit = 50
): Promise<AdminAuditEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const rows = await db
    .select({
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      action: auditEvents.action,
      targetUserId: auditEvents.targetUserId,
      occurredAt: auditEvents.occurredAt,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.occurredAt))
    .limit(safeLimit);

  return rows.map(row => ({
    ...row,
    metadata: parseRoleChangeMetadata(row.metadata),
  }));
}

// Audit events are intentionally append-only: no update/delete procedures are exposed.

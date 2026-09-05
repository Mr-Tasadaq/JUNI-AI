import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditEvents,
  conversations,
  InsertUser,
  messages,
  User,
  users,
} from "../drizzle/schema";
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

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  metadata: {
    persona?: "juni" | "sona";
    capability?: string;
    provider?: string;
  } | null;
  createdAt: Date;
};

export type OwnedConversation = ConversationSummary & {
  messages: ConversationMessage[];
};

const conversationColumns = {
  id: conversations.id,
  title: conversations.title,
  createdAt: conversations.createdAt,
  updatedAt: conversations.updatedAt,
};

const messageColumns = {
  id: messages.id,
  conversationId: messages.conversationId,
  role: messages.role,
  content: messages.content,
  metadata: messages.metadata,
  createdAt: messages.createdAt,
};

function parseConversationMetadata(
  value: unknown
): ConversationMessage["metadata"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const metadata: NonNullable<ConversationMessage["metadata"]> = {};
  if (record.persona === "juni" || record.persona === "sona")
    metadata.persona = record.persona;
  if (typeof record.capability === "string" && record.capability.length <= 80)
    metadata.capability = record.capability;
  if (typeof record.provider === "string" && record.provider.length <= 80)
    metadata.provider = record.provider;
  return Object.keys(metadata).length ? metadata : null;
}

export async function listConversationsForOwner(
  ownerId: number
): Promise<ConversationSummary[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db
    .select(conversationColumns)
    .from(conversations)
    .where(eq(conversations.ownerId, ownerId))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id));
}

export async function getConversationForOwner(
  ownerId: number,
  conversationId: string
): Promise<OwnedConversation | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const conversation = await db
    .select(conversationColumns)
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.ownerId, ownerId)
      )
    )
    .limit(1);
  if (!conversation[0]) return undefined;

  const ownedMessages = await db
    .select(messageColumns)
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.ownerId, ownerId)
      )
    )
    .orderBy(asc(messages.createdAt), asc(messages.id));

  return {
    ...conversation[0],
    messages: ownedMessages.map(message => ({
      ...message,
      metadata: parseConversationMetadata(message.metadata),
    })),
  };
}

export async function createConversationForOwner(
  ownerId: number,
  title: string
): Promise<ConversationSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const id = randomUUID();
  const now = new Date();
  await db.insert(conversations).values({
    id,
    ownerId,
    title,
    createdAt: now,
    updatedAt: now,
  });
  return { id, title, createdAt: now, updatedAt: now };
}

export async function addMessageForOwner(
  ownerId: number,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: ConversationMessage["metadata"]
): Promise<ConversationMessage | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const owned = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.ownerId, ownerId)
        )
      )
      .limit(1);
    if (!owned[0]) return undefined;

    const id = randomUUID();
    const createdAt = new Date();
    await tx.insert(messages).values({
      id,
      conversationId,
      ownerId,
      role,
      content,
      metadata: metadata ?? null,
      createdAt,
    });
    await tx
      .update(conversations)
      .set({ updatedAt: createdAt })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.ownerId, ownerId)
        )
      );

    return {
      id,
      conversationId,
      role,
      content,
      metadata: metadata ?? null,
      createdAt,
    };
  });
}

export async function renameConversationForOwner(
  ownerId: number,
  conversationId: string,
  title: string
): Promise<ConversationSummary | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(conversations)
    .set({ title })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.ownerId, ownerId)
      )
    );
  const updated = await db
    .select(conversationColumns)
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.ownerId, ownerId)
      )
    )
    .limit(1);
  return updated[0];
}

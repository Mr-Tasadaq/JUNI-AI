import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const auditEvents = mysqlTable(
  "auditEvents",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    actorUserId: int("actorUserId").notNull(),
    action: varchar("action", { length: 128 }).notNull(),
    targetUserId: int("targetUserId"),
    occurredAt: timestamp("occurredAt").defaultNow().notNull(),
    metadata: json("metadata").notNull(),
  },
  table => ({
    occurredAtIdx: index("audit_events_occurred_at_idx").on(table.occurredAt),
    actorIdx: index("audit_events_actor_idx").on(
      table.actorUserId,
      table.occurredAt
    ),
    actionIdx: index("audit_events_action_idx").on(
      table.action,
      table.occurredAt
    ),
  })
);

export const conversations = mysqlTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerId: int("ownerId").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerUpdatedIdx: index("conversations_owner_updated_idx").on(
      table.ownerId,
      table.updatedAt
    ),
  })
);

export const messages = mysqlTable(
  "messages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 36 }).notNull(),
    ownerId: int("ownerId").notNull(),
    role: mysqlEnum("role", ["user", "assistant"]).notNull(),
    content: text("content").notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    conversationCreatedIdx: index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
    ownerConversationIdx: index("messages_owner_conversation_idx").on(
      table.ownerId,
      table.conversationId,
      table.createdAt
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  conversations,
  InsertConversation,
  InsertMessage,
  InsertStoredFile,
  InsertUser,
  messages,
  storedFiles,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

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
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined || user.openId === ENV.ownerOpenId) {
    values.role = user.role ?? "admin";
    updateSet.role = values.role;
  }
  values.lastSignedIn ??= new Date();
  updateSet.lastSignedIn ??= new Date();
  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result[0];
}

export async function listConversations(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.updatedAt));
}

export async function createConversation(
  userId: number,
  title = "New conversation"
) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(conversations).values({ userId, title });
  const id = Number(result[0].insertId);
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new Error("Conversation was not created");
  return rows[0];
}

export async function getConversationForUser(
  conversationId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .limit(1);
  return rows[0];
}

export async function listMessages(conversationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId)
      )
    )
    .orderBy(messages.createdAt);
}

export async function createMessage(message: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(messages).values(message);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.id, Number(result[0].insertId)))
    .limit(1);
  if (!rows[0]) throw new Error("Message was not created");
  return rows[0];
}

export async function touchConversation(
  conversationId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId)
      )
    );
}

export async function registerStoredFile(file: InsertStoredFile) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(storedFiles).values(file);
  const rows = await db
    .select()
    .from(storedFiles)
    .where(eq(storedFiles.id, Number(result[0].insertId)))
    .limit(1);
  if (!rows[0]) throw new Error("File metadata was not created");
  return rows[0];
}

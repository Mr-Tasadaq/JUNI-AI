import type { User } from "../../drizzle/schema";

/**
 * Canonical identifier for the persisted `users` table.
 *
 * The database owns the concrete identifier strategy. This type deliberately
 * follows the Drizzle-inferred `User["id"]` type instead of duplicating it as
 * a manually maintained primitive or branded value.
 */
export type UserId = User["id"];

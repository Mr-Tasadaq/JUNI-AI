import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

const SCHEMA_VERSION = 1;

function splitStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function resolveDatabaseConfig(env = process.env) {
  const url = env.JUNI_DATABASE_URL?.trim()
    || (env.VERCEL === "1" ? "file:/tmp/juni.db" : "file:juni.db");

  return {
    url,
    authToken: env.JUNI_DATABASE_AUTH_TOKEN?.trim() || undefined,
  };
}

export function createJuniDatabase(options = {}) {
  const config = { ...resolveDatabaseConfig(), ...options };
  const client = createClient({
    url: config.url,
    authToken: config.authToken,
  });

  let readyPromise;

  async function initialize() {
    const schemaSql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await client.batch(splitStatements(schemaSql), "write");
    await client.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      args: [SCHEMA_VERSION, new Date().toISOString()],
    });
    return client;
  }

  return {
    client,
    ready: () => {
      readyPromise ??= initialize();
      return readyPromise;
    },
    config,
  };
}

export async function queryOne(client, sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows[0] ?? null;
}

export async function queryAll(client, sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows;
}

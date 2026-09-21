const buckets = new Map();

function normalizeSettings(limit, windowSeconds) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 20));
  const safeWindow = Math.max(1, Math.floor(Number(windowSeconds) || 60));
  return { limit: safeLimit, windowSeconds: safeWindow, windowMs: safeWindow * 1000 };
}

function localCheck(key, limit = 20, windowSeconds = 60, now = Date.now()) {
  const settings = normalizeSettings(limit, windowSeconds);
  const bucketKey = key + ":" + settings.limit + ":" + settings.windowSeconds;
  const existing = buckets.get(bucketKey);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + settings.windowMs;
    buckets.set(bucketKey, { count: 1, resetAt });
    return { allowed: true, limit: settings.limit, remaining: Math.max(0, settings.limit - 1), retryAfter: settings.windowSeconds, resetAt, store: "local" };
  }

  if (existing.count >= settings.limit) {
    return { allowed: false, limit: settings.limit, remaining: 0, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)), resetAt: existing.resetAt, store: "local" };
  }

  existing.count += 1;
  return { allowed: true, limit: settings.limit, remaining: Math.max(0, settings.limit - existing.count), retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)), resetAt: existing.resetAt, store: "local" };
}

export function checkRateLimit(key, limit = 20, windowSeconds = 60, now = Date.now()) {
  return localCheck(String(key ?? "unknown"), limit, windowSeconds, now);
}

export function clearRateLimitStore() { buckets.clear(); }

function isRemoteDatabaseUrl(url) {
  return /^(https?|libsql|wss?):/i.test(String(url ?? "").trim());
}

export function createRateLimiter({ client = null, ready = null, databaseUrl = "" } = {}) {
  const shared = Boolean(client && ready && isRemoteDatabaseUrl(databaseUrl));
  let cleanupCounter = 0;

  async function check(key, limit = 20, windowSeconds = 60, now = Date.now()) {
    const normalizedKey = String(key ?? "unknown");
    if (!shared) return localCheck(normalizedKey, limit, windowSeconds, now);

    const settings = normalizeSettings(limit, windowSeconds);
    const bucketKey = normalizedKey + ":" + settings.limit + ":" + settings.windowSeconds;
    const resetAt = now + settings.windowMs;

    try {
      await ready();
      const tx = await client.transaction("write");
      let row;

      try {
        await tx.execute({
          sql: `INSERT INTO rate_limit_buckets (
            bucket_key, count, reset_at, updated_at
          ) VALUES (?, 1, ?, ?)
          ON CONFLICT(bucket_key) DO UPDATE SET
            count = CASE WHEN rate_limit_buckets.reset_at <= ? THEN 1 ELSE rate_limit_buckets.count + 1 END,
            reset_at = CASE WHEN rate_limit_buckets.reset_at <= ? THEN ? ELSE rate_limit_buckets.reset_at END,
            updated_at = ?`,
          args: [bucketKey, resetAt, new Date(now).toISOString(), now, now, resetAt, new Date(now).toISOString()],
        });
        const result = await tx.execute({
          sql: "SELECT count, reset_at FROM rate_limit_buckets WHERE bucket_key = ?",
          args: [bucketKey],
        });
        row = result.rows[0] ?? null;
        await tx.commit();
      } catch (error) {
        try { await tx.rollback(); } catch {}
        throw error;
      }

      cleanupCounter += 1;
      if (cleanupCounter >= 100) {
        cleanupCounter = 0;
        try {
          await client.execute({ sql: "DELETE FROM rate_limit_buckets WHERE reset_at < ?", args: [now] });
        } catch {}
      }

      const count = Number(row?.count ?? 1);
      const bucketResetAt = Number(row?.reset_at ?? resetAt);
      return {
        allowed: count <= settings.limit,
        limit: settings.limit,
        remaining: Math.max(0, settings.limit - count),
        retryAfter: Math.max(1, Math.ceil((bucketResetAt - now) / 1000)),
        resetAt: bucketResetAt,
        store: "shared",
      };
    } catch {
      return { ...localCheck(normalizedKey, limit, windowSeconds, now), store: "local-fallback" };
    }
  }

  return Object.freeze({ check, shared, clearLocal: clearRateLimitStore });
}

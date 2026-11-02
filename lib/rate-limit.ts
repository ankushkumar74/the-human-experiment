import "server-only";
import type { Db } from "@/lib/db";

/**
 * Two complementary limiters.
 *
 * 1. MemoryRateLimiter: cheap, per server instance, no database round trip.
 *    Used for the 30-second GET poll, where a database write per poll per
 *    visitor would be wasteful. On serverless each instance has its own counters,
 *    so this is a best-effort brake, not a hard guarantee.
 *
 * 2. dbRateLimit: an atomic counter in PostgreSQL (hit_rate_limit RPC), shared by
 *    every instance. Used for POST /api/water, the write path.
 *
 * Neither is the cooldown itself. The real one-per-24h rule is enforced
 * atomically inside water_experiment(); these only blunt request floods.
 */

export class MemoryRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns true while the caller is within the limit. */
  hit(key: string, limit: number, windowSeconds: number): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || t >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: t + windowSeconds * 1000 });
      if (this.buckets.size > 5000) this.sweep(t);
      return true;
    }

    bucket.count += 1;
    return bucket.count <= limit;
  }

  private sweep(t: number): void {
    for (const [key, bucket] of this.buckets) {
      if (t >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

export const readLimiter = new MemoryRateLimiter();

export const LIMITS = {
  /** GET /api/experiment: per IP per minute (polling is ~2/min per visitor). */
  readPerMinute: 120,
  /** POST /api/water: per IP per minute. Shared networks stay comfortably under it. */
  waterPerMinute: 12,
} as const;

/**
 * Database-backed limit. If the limiter itself fails we fail OPEN: the atomic
 * cooldown still protects the shared state, and an outage in this helper should
 * not take the whole experiment down.
 */
export async function dbRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await db.rpc<boolean>("hit_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] limiter unavailable, failing open:", error.message);
    return true;
  }
  return data === true;
}

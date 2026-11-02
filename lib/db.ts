import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createLocalDb } from "@/lib/db-local";
import { requireEnv } from "@/lib/env";

/**
 * Minimal database port. All shared-state logic lives in PostgreSQL RPCs, so
 * the application only ever needs to call named functions. Keeping this tiny
 * lets the integration tests drive the real route handlers against a real
 * local PostgreSQL (see tests/helpers/pg-db.ts) without any Supabase account.
 */
export interface RpcResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<RpcResult<T>>;
}

let override: Db | null = null;
let cached: Db | null = null;

/** Tests only: replace the database port. Pass null to restore the default. */
export function setDbForTesting(db: Db | null): void {
  override = db;
}

/**
 * Service-role client. SERVER ONLY: the key bypasses Row Level Security and
 * must never reach the browser. `import "server-only"` makes the build fail
 * if this module is ever pulled into a client component.
 */
export function getDb(): Db {
  if (override) return override;
  if (cached) return cached;

  // Development convenience: run against a local PostgreSQL (scripts/local-db.mjs)
  // instead of Supabase. Impossible in production: NODE_ENV is inlined at build
  // time, so this branch is removed from production bundles, and it is also
  // refused on Vercel.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL !== "1" &&
    process.env.LOCAL_DATABASE_URL
  ) {
    cached = createLocalDb(process.env.LOCAL_DATABASE_URL);
    return cached;
  }

  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  cached = {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await client.rpc(fn, args);
      return {
        data: (data ?? null) as T | null,
        error: error ? { message: error.message, code: error.code } : null,
      };
    },
  };
  return cached;
}

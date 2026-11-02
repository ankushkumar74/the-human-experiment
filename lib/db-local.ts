import "server-only";
import type { Pool } from "pg";
import type { Db, RpcResult } from "@/lib/db";

/**
 * PostgreSQL adapter for the Db port, used for (a) the automated tests and
 * (b) local development WITHOUT a Supabase account (see scripts/local-db.mjs).
 *
 * Connections run as the `service_role` database role, exactly as PostgREST does
 * for the Supabase service key, so grants and RLS behave as in production.
 *
 * It is never used in production: lib/db.ts only reaches it when
 * NODE_ENV !== "production" and LOCAL_DATABASE_URL is set.
 */

export function createPgDb(pool: Pick<Pool, "query">): Db {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`bad function name: ${fn}`);
      const names = Object.keys(args);
      if (names.some((n) => !/^[a-z_][a-z0-9_]*$/.test(n))) throw new Error("bad argument name");
      const placeholders = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
      try {
        const res = await pool.query(
          `select public.${fn}(${placeholders}) as result`,
          names.map((n) => args[n]),
        );
        return { data: (res.rows[0]?.result ?? null) as T | null, error: null };
      } catch (err) {
        const e = err as { message: string; code?: string };
        return { data: null, error: { message: e.message, code: e.code } };
      }
    },
  };
}

export function createLocalDb(connectionString: string): Db {
  let pool: Pool | undefined;
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      if (!pool) {
        // Dynamic import keeps `pg` (a dev dependency) out of production bundles.
        const { Pool: PgPool } = await import("pg");
        pool = new PgPool({ connectionString, max: 5, options: "-c role=service_role" });
        pool.on("error", () => {});
      }
      return createPgDb(pool).rpc<T>(fn, args);
    },
  };
}

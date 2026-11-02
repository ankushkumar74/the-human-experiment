import type { Pool } from "pg";
import type { Db, RpcResult } from "@/lib/db";

/**
 * Test implementation of the application's Db port backed by a real
 * PostgreSQL connection that runs as `service_role`, exactly like PostgREST
 * does for the Supabase service key. Route handlers therefore exercise the real
 * SQL functions, grants and RLS in tests.
 */
export function pgDb(pool: Pool): Db {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`bad function name: ${fn}`);
      const names = Object.keys(args);
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

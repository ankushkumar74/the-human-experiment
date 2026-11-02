import type { Pool } from "pg";
import { createPgDb } from "@/lib/db-local";
import type { Db } from "@/lib/db";

/**
 * Test implementation of the application's Db port backed by a real PostgreSQL
 * connection that runs as `service_role`, exactly like PostgREST does for the
 * Supabase service key. Route handlers therefore exercise the real SQL
 * functions, grants and RLS in tests.
 */
export function pgDb(pool: Pool): Db {
  return createPgDb(pool);
}

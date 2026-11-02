import { createHash, randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { inject } from "vitest";

export type DbRole = "postgres" | "service_role" | "anon" | "authenticated";

export interface TestDatabase {
  name: string;
  url: string;
  /** Pool whose connections run as the given role (default: the service role). */
  pool(role?: DbRole, max?: number): Pool;
  /** Superuser pool for arranging state (backdating events, etc.). */
  admin: Pool;
  drop(): Promise<void>;
}

/** Clones the fully-migrated template into a brand-new database for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject("pgAdminUrl");
  const template = inject("pgTemplateDb");
  const name = `he_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const root = new Client({ connectionString: adminUrl });
  await root.connect();
  await root.query(`create database ${name} template ${template}`);
  await root.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const dbUrl = url.toString();

  const pools: Pool[] = [];
  const makePool = (role: DbRole, max: number) => {
    const pool = new Pool({
      connectionString: dbUrl,
      max,
      // Same effect as PostgREST switching to the request's role.
      options: role === "postgres" ? undefined : `-c role=${role}`,
    });
    // Idle clients get terminated when a test database is dropped. Without a
    // listener, node-postgres rethrows that as an uncaught exception. Real query
    // failures during a test still reject normally.
    pool.on("error", () => {});
    pools.push(pool);
    return pool;
  };

  const admin = makePool("postgres", 5);

  return {
    name,
    url: dbUrl,
    admin,
    pool: (role = "service_role", max = 10) => makePool(role, max),
    async drop() {
      await Promise.all(pools.map((p) => p.end().catch(() => {})));
      const cleaner = new Client({ connectionString: adminUrl });
      await cleaner.connect();
      await cleaner.query(`drop database if exists ${name} with (force)`);
      await cleaner.end();
    },
  };
}

/** Deterministic 64-hex-char visitor hash, shaped like the application's HMAC output. */
export function fakeVisitorHash(seed: string | number): string {
  return createHash("sha256").update(`test-visitor:${seed}`).digest("hex");
}

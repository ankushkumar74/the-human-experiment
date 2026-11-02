import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestDatabase, fakeVisitorHash, type TestDatabase } from "../helpers/db";
import { SLUG, water } from "../helpers/actions";

/**
 * Proves a hostile visitor holding only the PUBLIC anon key cannot touch shared
 * state, whatever they send to the Supabase REST API. The anon pool below runs
 * as the real `anon` role, subject to the same grants and RLS as production.
 */

const TABLES = [
  "experiments",
  "growth_stages",
  "experiment_state",
  "participants",
  "watering_events",
  "rate_limits",
] as const;

let db: TestDatabase;
let anon: Pool;
let authenticated: Pool;
beforeAll(async () => {
  db = await createTestDatabase();
  anon = db.pool("anon");
  authenticated = db.pool("authenticated");
  // A few real events so "can read nothing" is meaningful.
  const svc = db.pool();
  for (let i = 0; i < 3; i++) await water(svc, `sec-${i}`);
});
afterAll(async () => {
  await db.drop();
});

describe("Row Level Security is on", () => {
  it.each(TABLES)("RLS is enabled on %s", async (table) => {
    const res = await db.admin.query(
      "select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass",
      [table],
    );
    expect(res.rows[0].relrowsecurity).toBe(true);
  });

  it("no table has any policy granting access to anon or authenticated", async () => {
    const res = await db.admin.query(
      "select tablename, policyname, roles from pg_policies where schemaname = 'public'",
    );
    expect(res.rows).toEqual([]);
  });
});

describe.each([
  ["anon", () => anon],
  ["authenticated", () => authenticated],
] as const)("%s role cannot reach base tables", (_role, getPool) => {
  it.each(TABLES)("cannot SELECT from %s", async (table) => {
    await expect(getPool().query(`select * from public.${table}`)).rejects.toThrow(/permission denied/i);
  });

  it("cannot UPDATE shared experiment state", async () => {
    await expect(
      getPool().query("update public.experiment_state set total_waterings = 999999, health = 100"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot INSERT a watering event", async () => {
    await expect(
      getPool().query(
        `insert into public.watering_events (experiment_id, participant_id, sequence_number)
         select e.id, p.id, 9999 from public.experiments e, public.participants p limit 1`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot INSERT a participant or DELETE anything", async () => {
    await expect(
      getPool().query(
        "insert into public.participants (experiment_id, visitor_hash) select id, repeat('a', 64) from public.experiments",
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(getPool().query("delete from public.watering_events")).rejects.toThrow(/permission denied/i);
    await expect(getPool().query("truncate public.watering_events")).rejects.toThrow(/permission denied/i);
  });

  it("cannot call the watering, state or rate-limit RPCs", async () => {
    await expect(
      getPool().query("select public.water_experiment($1, $2, null)", [SLUG, fakeVisitorHash("x")]),
    ).rejects.toThrow(/permission denied/i);
    await expect(getPool().query("select public.get_experiment_state($1, null)", [SLUG])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(getPool().query("select public.hit_rate_limit('k', 1, 60)")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("cannot call internal helper functions", async () => {
    await expect(
      getPool().query("select public._advance_health(gen_random_uuid(), now())"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("state is unchanged after all those attempts", async () => {
    const res = await db.admin.query(
      "select total_waterings::int as total, health from public.experiment_state",
    );
    expect(res.rows[0]).toEqual({ total: 3, health: 70 });
  });
});

describe("the only public read access: aggregate views", () => {
  it("anon can read current state", async () => {
    const res = await anon.query("select * from public.public_experiment_state");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      slug: SLUG,
      total_waterings: "3",
      health: 70,
      growth_stage: 0,
      stage_name: "Seed",
    });
  });

  it("anon can read history and milestones", async () => {
    const history = await anon.query("select * from public.experiment_daily_history");
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({ waterings: 3, participants: 3 });
    await expect(anon.query("select * from public.experiment_milestones")).resolves.toBeDefined();
  });

  it("views expose no visitor hashes, participant ids or request ids", async () => {
    const res = await db.admin.query(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('public_experiment_state','experiment_daily_history','experiment_milestones')`,
    );
    const columns = res.rows.map((r) => r.column_name as string);
    for (const forbidden of ["visitor_hash", "participant_id", "request_id", "id"]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("views are read-only for anon", async () => {
    // Postgres may reject on view updatability or on privileges; either way it is denied.
    await expect(
      anon.query("update public.public_experiment_state set health = 100"),
    ).rejects.toThrow(/permission denied|cannot update view/i);

    // And the privilege itself is absent, independent of view updatability.
    for (const view of ["public_experiment_state", "experiment_daily_history", "experiment_milestones"]) {
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const res = await db.admin.query("select has_table_privilege('anon', $1, $2) as has", [
          `public.${view}`,
          priv,
        ]);
        expect(res.rows[0].has, `${view} ${priv}`).toBe(false);
      }
    }
  });

  it("anon holds SELECT on the views and nothing else anywhere in the schema", async () => {
    const res = await db.admin.query(
      `select c.relname, c.relkind, p.priv
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
         cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
        where c.relkind in ('r','v')
          and has_table_privilege('anon', c.oid, p.priv)`,
    );
    const granted = res.rows.map((r) => `${r.relname}:${r.priv}`).sort();
    expect(granted).toEqual([
      "experiment_daily_history:SELECT",
      "experiment_milestones:SELECT",
      "public_experiment_state:SELECT",
    ]);
  });

  it("anon cannot use the identity sequence", async () => {
    const res = await db.admin.query(
      `select has_sequence_privilege('anon', pg_get_serial_sequence('public.watering_events', 'id'), 'USAGE') as usage`,
    );
    expect(res.rows[0].usage).toBe(false);
  });
});

describe("the service role (server only) can do its job", () => {
  it("can call the RPCs", async () => {
    const r = await water(db.pool(), "service-ok");
    expect(r.ok).toBe(true);
  });
});

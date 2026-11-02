import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { water, waterMany } from "../helpers/actions";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

const hit = async (key: string, limit: number, windowSeconds: number) =>
  (
    await db.pool().query("select public.hit_rate_limit($1, $2, $3) as ok", [key, limit, windowSeconds])
  ).rows[0].ok as boolean;

describe("hit_rate_limit", () => {
  it("allows up to the limit, then rejects", async () => {
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await hit("limit-a", 3, 3600));
    expect(outcomes).toEqual([true, true, true, false, false]);
  });

  it("counts keys independently", async () => {
    expect(await hit("limit-b", 1, 3600)).toBe(true);
    expect(await hit("limit-c", 1, 3600)).toBe(true);
    expect(await hit("limit-b", 1, 3600)).toBe(false);
  });

  it("is atomic: 40 parallel hits against a limit of 10 allow exactly 10", async () => {
    const pool = db.pool("service_role", 40);
    const results = await Promise.all(
      Array.from({ length: 40 }, async () =>
        (await pool.query("select public.hit_rate_limit('limit-par', 10, 3600) as ok")).rows[0].ok,
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
  });

  it("opens a fresh window after it elapses", async () => {
    expect(await hit("limit-win", 1, 1)).toBe(true);
    expect(await hit("limit-win", 1, 1)).toBe(false);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await hit("limit-win", 1, 1)).toBe(true);
  });

  it("rejects nonsense arguments", async () => {
    await expect(db.pool().query("select public.hit_rate_limit('k', 0, 60)")).rejects.toThrow();
    await expect(db.pool().query("select public.hit_rate_limit('k', 5, 0)")).rejects.toThrow();
  });
});

describe("history and milestones come from real events", () => {
  it("is empty before anyone waters", async () => {
    const h = await db.admin.query("select * from public.experiment_daily_history");
    const m = await db.admin.query("select * from public.experiment_milestones");
    expect(h.rows).toEqual([]);
    expect(m.rows).toEqual([]);
  });

  it("daily history matches the events exactly", async () => {
    await waterMany(db.pool(), 12);
    const h = await db.admin.query("select waterings, participants from public.experiment_daily_history");
    expect(h.rows).toEqual([{ waterings: 12, participants: 12 }]);
  });

  it("splits events across UTC days", async () => {
    await db.admin.query(
      `update public.watering_events set watered_at = watered_at - interval '1 day'
        where sequence_number <= 5`,
    );
    const h = await db.admin.query(
      "select day::text as day, waterings from public.experiment_daily_history order by day",
    );
    expect(h.rows.map((r) => r.waterings)).toEqual([5, 7]);
  });

  it("records a milestone at the exact watering that reached the stage", async () => {
    await waterMany(db.pool(), 13, 12); // total now 25
    const m = await db.admin.query(
      "select stage, name, threshold::int as threshold, reached_at from public.experiment_milestones",
    );
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ stage: 1, name: "Sprout", threshold: 25 });

    const ev = await db.admin.query(
      "select watered_at from public.watering_events where sequence_number = 25",
    );
    expect(new Date(m.rows[0].reached_at).getTime()).toBe(new Date(ev.rows[0].watered_at).getTime());
  });

  it("does not report a milestone that has not been reached", async () => {
    const m = await db.admin.query("select stage from public.experiment_milestones order by stage");
    expect(m.rows.map((r) => r.stage)).toEqual([1]);
    // One more watering changes nothing.
    await water(db.pool(), "extra");
    const again = await db.admin.query("select stage from public.experiment_milestones order by stage");
    expect(again.rows.map((r) => r.stage)).toEqual([1]);
  });
});

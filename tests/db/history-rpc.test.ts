import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, fakeVisitorHash, type TestDatabase } from "../helpers/db";
import { SLUG, water, waterMany } from "../helpers/actions";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

const history = async (days?: number, slug = SLUG) =>
  (
    await db.pool().query("select public.get_experiment_history($1, $2) as r", [slug, days ?? null])
  ).rows[0].r;
const contribution = async (n: number | null, slug = SLUG) =>
  (await db.pool().query("select public.get_contribution($1, $2) as r", [slug, n])).rows[0].r;

describe("get_experiment_history", () => {
  it("is empty and honest before anyone waters", async () => {
    const h = await history();
    expect(h).toMatchObject({ ok: true, total_waterings: 0, total_visitors: 0, days: [], milestones: [] });
  });

  it("reports real totals, per-day counts and reached milestones", async () => {
    await waterMany(db.pool(), 30);
    const h = await history();
    expect(h.total_waterings).toBe(30);
    expect(h.total_visitors).toBe(30);
    expect(h.days).toHaveLength(1);
    expect(h.days[0]).toMatchObject({ waterings: 30, participants: 30 });
    expect(h.milestones.map((m: { stage: number }) => m.stage)).toEqual([1]);
  });

  it("returns days oldest-first and honours the day limit", async () => {
    // Spread the events over 5 different UTC days.
    await db.admin.query(
      `update public.watering_events
          set watered_at = watered_at - make_interval(days => (sequence_number % 5)::int)`,
    );
    const all = await history(14);
    const days = all.days.map((d: { day: string }) => d.day);
    expect(days).toEqual([...days].sort());
    expect(all.days).toHaveLength(5);
    expect(all.days.reduce((s: number, d: { waterings: number }) => s + d.waterings, 0)).toBe(30);

    const limited = await history(2);
    expect(limited.days).toHaveLength(2);
    // The two MOST RECENT days, still ordered oldest-first.
    expect(limited.days.map((d: { day: string }) => d.day)).toEqual(days.slice(-2));
  });

  it("clamps absurd day limits instead of failing", async () => {
    expect((await history(0)).days.length).toBeGreaterThanOrEqual(1);
    expect((await history(100000)).ok).toBe(true);
  });

  it("returns not_found for an unknown experiment", async () => {
    expect(await history(14, "nope")).toEqual({ ok: false, code: "not_found" });
  });

  it("exposes no visitor identifiers anywhere in the payload", async () => {
    const text = JSON.stringify(await history());
    expect(text).not.toMatch(/visitor_hash|participant_id|request_id/);
    expect(text).not.toContain(fakeVisitorHash(0));
  });
});

describe("get_contribution", () => {
  it("returns the real number, time and the stage reached at that watering", async () => {
    const c = await contribution(25);
    expect(c).toMatchObject({
      ok: true,
      contribution_number: 25,
      stage: 1,
      stage_name: "Sprout",
      slug: SLUG,
    });
    const ev = await db.admin.query("select watered_at from public.watering_events where sequence_number = 25");
    expect(new Date(c.watered_at).getTime()).toBe(new Date(ev.rows[0].watered_at).getTime());
  });

  it("uses the stage at the time, not today's stage", async () => {
    expect((await contribution(1)).stage_name).toBe("Seed");
    expect((await contribution(24)).stage_name).toBe("Seed");
    expect((await contribution(30)).stage_name).toBe("Sprout");
  });

  it.each([
    ["a number that has not happened yet", 31],
    ["zero", 0],
    ["a negative number", -4],
    ["null", null],
  ])("returns not_found for %s (nothing is invented)", async (_n, value) => {
    expect(await contribution(value as number | null)).toEqual({ ok: false, code: "not_found" });
  });

  it("returns not_found for an unknown experiment", async () => {
    expect(await contribution(1, "nope")).toEqual({ ok: false, code: "not_found" });
  });

  it("never exposes who made the contribution", async () => {
    const text = JSON.stringify(await contribution(5));
    expect(text).not.toMatch(/visitor|participant|hash|request/i);
  });

  it("is reachable by the service role only", async () => {
    await expect(db.pool("anon").query("select public.get_contribution($1, 1)", [SLUG])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      db.pool("authenticated").query("select public.get_experiment_history($1, 7)", [SLUG]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a freshly arrived watering becomes a valid contribution page immediately", async () => {
    const r = await water(db.pool(), "latecomer");
    const c = await contribution(r.contribution_number!);
    expect(c.ok).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_STAGE_INDEX, STAGES, stageIndexFor, stageNameFor } from "@/lib/plant";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { stateRow, water } from "../helpers/actions";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

describe("growth stages: SQL and TypeScript agree", () => {
  it("the growth_stages table matches lib/plant.ts exactly", async () => {
    const res = await db.admin.query(
      "select stage::int as stage, name, threshold::int as threshold from public.growth_stages order by stage",
    );
    expect(res.rows).toEqual(
      STAGES.map((s) => ({ stage: s.index, name: s.name, threshold: s.threshold })),
    );
  });

  it("growth_stage_for() equals stageIndexFor() on both sides of every threshold", async () => {
    const probes = new Set<number>([0, 1, 5000, 100000]);
    for (const s of STAGES) {
      probes.add(s.threshold);
      probes.add(s.threshold + 1);
      if (s.threshold > 0) probes.add(s.threshold - 1);
    }
    for (const total of probes) {
      // Internal helper (not granted to service_role), so probe it as the owner.
      const res = await db.admin.query("select public.growth_stage_for($1::bigint)::int as s", [total]);
      expect(res.rows[0].s, `total=${total}`).toBe(stageIndexFor(total));
    }
  });
});

describe("growth thresholds (TypeScript)", () => {
  const cases: Array<[number, number, string]> = [
    [0, 0, "Seed"],
    [24, 0, "Seed"],
    [25, 1, "Sprout"],
    [99, 1, "Sprout"],
    [100, 2, "Tiny plant"],
    [299, 2, "Tiny plant"],
    [300, 3, "Growing plant"],
    [749, 3, "Growing plant"],
    [750, 4, "Bushy plant"],
    [1499, 4, "Bushy plant"],
    [1500, 5, "Flowering plant"],
    [2999, 5, "Flowering plant"],
    [3000, 6, "Legendary plant"],
    [1_000_000, 6, "Legendary plant"],
  ];
  it.each(cases)("%i waterings → stage %i (%s)", (total, index, name) => {
    expect(stageIndexFor(total)).toBe(index);
    expect(stageNameFor(index)).toBe(name);
  });

  it("never goes below Seed or above Legendary", () => {
    expect(stageIndexFor(-50)).toBe(0);
    expect(stageNameFor(-3)).toBe("Seed");
    expect(stageNameFor(99)).toBe(STAGES[MAX_STAGE_INDEX].name);
  });
});

describe("growth through real waterings", () => {
  it("advances to Sprout exactly at the 25th watering", async () => {
    const pool = db.pool();
    for (let i = 1; i <= 24; i++) {
      const r = await water(pool, `g${i}`);
      expect(r.state?.growth_stage, `after ${i}`).toBe(0);
    }
    const r25 = await water(pool, "g25");
    expect(r25.state?.total_waterings).toBe(25);
    expect(r25.state?.growth_stage).toBe(1);
    expect((await stateRow(db.admin)).growth_stage).toBe(1);
  });
});

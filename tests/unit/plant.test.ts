import { describe, expect, it } from "vitest";
import {
  clampHealth,
  COOLDOWN_MS,
  HEALTH,
  healthMood,
  stageProgress,
  STAGES,
} from "@/lib/plant";
import { toSnapshot, type RpcState } from "@/lib/snapshot";

describe("stageProgress", () => {
  it("reports the fraction through the current stage and what remains", () => {
    const p = stageProgress(60); // Sprout is 25..100, so 35/75
    expect(p.current.name).toBe("Sprout");
    expect(p.next?.name).toBe("Tiny plant");
    expect(p.fraction).toBeCloseTo(35 / 75, 5);
    expect(p.remaining).toBe(40);
  });

  it("starts each stage at 0 and the Seed at 0", () => {
    expect(stageProgress(0).fraction).toBe(0);
    expect(stageProgress(25).fraction).toBe(0);
    expect(stageProgress(25).current.name).toBe("Sprout");
  });

  it("is complete at the final stage", () => {
    const p = stageProgress(3000);
    expect(p.current.name).toBe("Legendary plant");
    expect(p.next).toBeNull();
    expect(p.fraction).toBe(1);
    expect(p.remaining).toBe(0);
    expect(stageProgress(999999).fraction).toBe(1);
  });

  it("is monotonic across the whole range", () => {
    let last = -1;
    for (let total = 0; total <= 3200; total += 7) {
      const p = stageProgress(total);
      const score = p.current.index + p.fraction;
      expect(score).toBeGreaterThanOrEqual(last);
      last = score;
    }
  });

  it("stage thresholds are strictly increasing and start at zero", () => {
    expect(STAGES[0].threshold).toBe(0);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].threshold).toBeGreaterThan(STAGES[i - 1].threshold);
      expect(STAGES[i].index).toBe(i);
    }
  });
});

describe("health rules and helpers", () => {
  it("matches the specified constants", () => {
    expect(HEALTH).toMatchObject({ initial: 70, min: 0, max: 100, dailyDecay: 2, wateringsPerRecoveredPoint: 10 });
    expect(COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("clamps to 0..100 and rounds", () => {
    expect(clampHealth(-5)).toBe(0);
    expect(clampHealth(105)).toBe(100);
    expect(clampHealth(55.4)).toBe(55);
  });

  it.each([
    [100, "thriving"],
    [75, "thriving"],
    [74, "okay"],
    [45, "okay"],
    [44, "thirsty"],
    [20, "thirsty"],
    [19, "critical"],
    [0, "critical"],
  ])("health %i is %s", (health, mood) => {
    expect(healthMood(health)).toBe(mood);
  });
});

describe("toSnapshot", () => {
  const state: RpcState = {
    slug: "save-the-plant",
    status: "active",
    total_waterings: 130 as unknown as number,
    health: 64,
    growth_stage: 2,
    last_watered_at: "2026-11-03T10:00:00.123456+00:00",
    updated_at: "2026-11-03T10:00:00.123456+00:00",
  };

  it("maps database fields to the public API shape", () => {
    expect(toSnapshot(state, false, "2026-11-04T10:00:00.123456+00:00")).toEqual({
      slug: "save-the-plant",
      totalWaterings: 130,
      health: 64,
      growthStage: 2,
      stageName: "Tiny plant",
      canWater: false,
      nextEligibleAt: "2026-11-04T10:00:00.123Z",
      updatedAt: "2026-11-03T10:00:00.123Z",
    });
  });

  it("uses null for no cooldown and never leaks internal fields", () => {
    const s = toSnapshot(state, true, null);
    expect(s.nextEligibleAt).toBeNull();
    expect(Object.keys(s).sort()).toEqual(
      ["canWater", "growthStage", "health", "nextEligibleAt", "slug", "stageName", "totalWaterings", "updatedAt"].sort(),
    );
  });
});

import { describe, expect, it } from "vitest";
import { buildPlantGrid, FIXED_COLORS, GRID_H, GRID_W, gridToRects, PALETTES, PLANT_ROWS, STAGE_COUNT } from "@/components/plant/pixel-art";
import type { HealthMood } from "@/lib/plant";

const MOODS: HealthMood[] = ["thriving", "okay", "thirsty", "critical"];
const KNOWN = new Set([".", ...Object.keys(FIXED_COLORS), ...Object.keys(PALETTES.thriving)]);

describe("pixel-art plant", () => {
  it("has a valid 16x20 grid for every stage and mood, using only known palette keys", () => {
    for (let stage = 0; stage < STAGE_COUNT; stage++) {
      for (const mood of MOODS) {
        const rows = buildPlantGrid(stage, mood);
        expect(rows).toHaveLength(GRID_H);
        for (const row of rows) {
          expect(row).toHaveLength(GRID_W);
          for (const ch of row) expect(KNOWN.has(ch), `unknown key "${ch}" at stage ${stage}`).toBe(true);
        }
      }
    }
  });

  it("every colour key used has a real hex colour", () => {
    const palette = { ...FIXED_COLORS, ...PALETTES.thriving };
    for (let stage = 0; stage < STAGE_COUNT; stage++) {
      for (const ch of buildPlantGrid(stage).join("")) {
        if (ch !== ".") expect(palette[ch], `missing colour for "${ch}"`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("keeps the plant above the pot: plant rows never spill into pot rows", () => {
    for (let stage = 0; stage < STAGE_COUNT; stage++) {
      const rows = buildPlantGrid(stage);
      // Every pot row (12+) holds only soil, pot, face and tear pixels.
      for (const row of rows.slice(PLANT_ROWS)) expect(row).toMatch(/^[.dDchCkz]*$/);
    }
  });

  it("grows monotonically: each stage has at least as many plant pixels as the one before it, except the seed", () => {
    const count = (stage: number) =>
      buildPlantGrid(stage)
        .slice(0, PLANT_ROWS)
        .join("")
        .replaceAll(".", "").length;
    for (let stage = 2; stage < STAGE_COUNT; stage++) expect(count(stage)).toBeGreaterThanOrEqual(count(stage - 1));
    expect(count(6)).toBeGreaterThan(count(1));
  });

  it("each of the seven stages looks different", () => {
    const seen = new Set(Array.from({ length: STAGE_COUNT }, (_, s) => buildPlantGrid(s).join("|")));
    expect(seen.size).toBe(STAGE_COUNT);
  });

  it("the face changes with mood, so health is readable without numbers", () => {
    const faces = new Set(MOODS.map((m) => buildPlantGrid(2, m).slice(PLANT_ROWS).join("|")));
    expect(faces.size).toBe(MOODS.length);
  });

  it("clamps out-of-range stages instead of crashing", () => {
    expect(buildPlantGrid(-3)).toEqual(buildPlantGrid(0));
    expect(buildPlantGrid(99)).toEqual(buildPlantGrid(6));
    expect(buildPlantGrid(2.9)).toEqual(buildPlantGrid(2));
  });

  it("merges horizontal runs into rects that cover exactly the painted pixels", () => {
    const rows = buildPlantGrid(4, "thriving");
    const rects = gridToRects(rows, "thriving");
    const painted = rows.join("").replaceAll(".", "").length;
    expect(rects.reduce((sum, r) => sum + r.w, 0)).toBe(painted);
    expect(rects.length).toBeLessThan(painted); // merged
    for (const r of rects) expect(r.plant).toBe(r.y < PLANT_ROWS);
  });

  it("changes leaf colour with mood and gives the legendary plant a golden rim", () => {
    const leaf = (mood: HealthMood) => gridToRects(buildPlantGrid(3, mood), mood).find((r) => r.plant)!.fill;
    expect(new Set(MOODS.map(leaf)).size).toBeGreaterThan(1);
    const rim = (legendary: boolean) =>
      gridToRects(buildPlantGrid(6), "thriving", legendary).find((r) => r.y === 13)!.fill;
    expect(rim(true)).toBe("#ffd84d");
    expect(rim(false)).not.toBe("#ffd84d");
  });
});

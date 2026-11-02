import { describe, expect, it } from "vitest";
import { plantToSvg } from "@/components/plant/pixel-art";
import { parseContributionNumber, toContribution } from "@/lib/contribution";

describe("contribution route parameter", () => {
  it("accepts plain positive integers", () => {
    expect(parseContributionNumber("1")).toBe(1);
    expect(parseContributionNumber("357")).toBe(357);
    expect(parseContributionNumber("9999999999")).toBe(9_999_999_999);
  });

  it("rejects everything else (no SQL-ish, negative, zero, padded, decimal, huge or empty input)", () => {
    for (const bad of ["", "0", "-1", "01", "1.5", "1e3", "abc", "1 2", " 3", "3 ", "1;drop table x", "10000000000", "０１", "%31", "0x10"]) {
      expect(parseContributionNumber(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("toContribution", () => {
  it("maps the RPC row and exposes no identifiers", () => {
    const c = toContribution({
      ok: true,
      code: "contribution",
      contribution_number: 42,
      watered_at: "2026-11-03T10:00:00+00:00",
      stage: 1,
      stage_name: "Sprout",
      // anything extra from a future RPC change must not leak through
      visitor_hash: "deadbeef",
    } as never);
    expect(c).toEqual({ number: 42, wateredAt: "2026-11-03T10:00:00.000Z", stage: 1, stageName: "Sprout" });
    expect(JSON.stringify(c)).not.toMatch(/visitor|hash|participant/i);
  });

  it("returns null when the contribution does not exist", () => {
    expect(toContribution({ ok: false, code: "not_found" })).toBeNull();
  });
});

describe("plantToSvg (share images and icon)", () => {
  it("produces a valid standalone svg for every stage and mood", () => {
    for (let stage = 0; stage < 7; stage++) {
      for (const mood of ["thriving", "okay", "thirsty", "critical"] as const) {
        const svg = plantToSvg(stage, mood);
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
        expect(svg.endsWith("</svg>")).toBe(true);
        expect(svg).toContain('viewBox="0 0 16 20"');
        expect(svg).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it("droops the plant when health is low and keeps it upright when thriving", () => {
    expect(plantToSvg(3, "thriving")).toContain('rotate(0 ');
    expect(plantToSvg(3, "critical")).toContain('rotate(-13 ');
  });
});

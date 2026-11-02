import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("supabase/setup.sql (the one-paste setup file)", () => {
  it("is in sync with supabase/migrations (run `npm run db:bundle` if this fails)", () => {
    expect(() =>
      execFileSync("node", ["scripts/bundle-migrations.mjs", "--check"], { cwd: root, stdio: "pipe" }),
    ).not.toThrow();
  });

  it("contains every migration, in order", () => {
    const bundle = fs.readFileSync(path.join(root, "supabase/setup.sql"), "utf8");
    const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    let at = -1;
    for (const f of files) {
      const next = bundle.indexOf(`-- ---------- ${f} ----------`);
      expect(next, f).toBeGreaterThan(at);
      at = next;
    }
  });
});

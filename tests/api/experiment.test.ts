import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDbForTesting } from "@/lib/db";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { pgDb } from "../helpers/pg-db";
import { Browser } from "../helpers/browser";
import { setLastHealthDaysAgo, stateRow } from "../helpers/actions";

const SECRET = "test-secret-".padEnd(48, "x");

let db: TestDatabase;
beforeAll(async () => {
  process.env.VISITOR_COOKIE_SECRET = SECRET;
  db = await createTestDatabase();
  setDbForTesting(pgDb(db.pool("service_role", 20)));
});
afterAll(async () => {
  setDbForTesting(null);
  await db.drop();
});
beforeEach(() => {
  process.env.VISITOR_COOKIE_SECRET = SECRET;
});

describe("GET /api/experiment", () => {
  it("returns the documented shape for a brand-new visitor", async () => {
    const r = await new Browser().get();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      slug: "save-the-plant",
      totalWaterings: 0,
      health: 70,
      growthStage: 0,
      stageName: "Seed",
      canWater: true,
      nextEligibleAt: null,
      updatedAt: expect.any(String),
    });
    expect(new Date(r.body.updatedAt).toString()).not.toBe("Invalid Date");
  });

  it("is never cached", async () => {
    const r = await new Browser().get();
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("issues a signed, HTTP-only, SameSite visitor cookie on first contact", async () => {
    const r = await new Browser().get();
    expect(r.setCookies).toHaveLength(1);
    const cookie = r.setCookies[0];
    expect(cookie).toMatch(/^he_visitor=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it("does not re-issue the cookie once the visitor has a valid one", async () => {
    const b = new Browser();
    await b.get();
    const again = await b.get();
    expect(again.setCookies).toHaveLength(0);
  });

  it("never exposes visitor identifiers in the body", async () => {
    const b = new Browser();
    const r = await b.get();
    const text = JSON.stringify(r.body);
    const id = b.cookie!.split("=")[1].slice(0, 36);
    expect(text).not.toContain(id);
    expect(text).not.toMatch(/hash|visitor|participant/i);
  });

  it("returns 404 for an unknown experiment and 400 for a malformed slug", async () => {
    const notFound = await new Browser().get("/api/experiment?slug=no-such-thing");
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe("not_found");

    const bad = await new Browser().get("/api/experiment?slug=../../etc/passwd");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_slug");
  });

  it("applies pending daily decay when a new UTC day has started", async () => {
    await setLastHealthDaysAgo(db.admin, 3);
    const r = await new Browser().get();
    expect(r.body.health).toBe(64);
    expect((await stateRow(db.admin)).health).toBe(64);
  });

  it("returns a generic 500, with no internals, when the server is misconfigured", async () => {
    delete process.env.VISITOR_COOKIE_SECRET;
    const r = await new Browser().get();
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("server_error");
    expect(JSON.stringify(r.body)).not.toMatch(/VISITOR_COOKIE_SECRET|env/i);
  });

  it("returns 503 (not 500) when the database is unreachable, without leaking the reason", async () => {
    setDbForTesting({
      rpc: async () => ({ data: null, error: { message: "connection to 10.9.8.7:5432 refused" } }),
    });
    try {
      const r = await new Browser().get();
      expect(r.status).toBe(503);
      expect(r.headers.get("retry-after")).toBe("5");
      expect(JSON.stringify(r.body)).not.toContain("10.9.8.7");
    } finally {
      setDbForTesting(pgDb(db.pool("service_role", 20)));
    }
  });
});

describe("visitor identity", () => {
  it("accepts a UUID hint when there is no cookie and signs it into a cookie", async () => {
    const hint = randomUUID();
    const b = new Browser({ hint });
    const r = await b.get();
    expect(r.setCookies[0]).toContain(`he_visitor=${hint}.`);
  });

  it("ignores a malformed hint and mints a fresh identity", async () => {
    const r = await new Browser({ hint: "not-a-uuid" }).get();
    expect(r.status).toBe(200);
    expect(r.setCookies).toHaveLength(1);
    expect(r.setCookies[0]).not.toContain("not-a-uuid");
  });

  it("a forged cookie is rejected and replaced, never trusted", async () => {
    const victimId = randomUUID();
    const b = new Browser();
    b.cookie = `he_visitor=${victimId}.${"A".repeat(43)}`;
    const r = await b.get();
    expect(r.status).toBe(200);
    expect(r.setCookies).toHaveLength(1);
    expect(r.setCookies[0]).not.toContain(victimId);
  });

  it("a cookie signed with a different secret is rejected", async () => {
    const other = new Browser();
    process.env.VISITOR_COOKIE_SECRET = "another-secret-".padEnd(48, "y");
    await other.get(); // cookie now signed with the other secret
    process.env.VISITOR_COOKIE_SECRET = SECRET;
    const r = await other.get();
    expect(r.setCookies).toHaveLength(1); // re-issued under the real secret
  });
});

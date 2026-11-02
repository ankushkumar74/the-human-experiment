import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setDbForTesting } from "@/lib/db";
import { handleHistory } from "@/lib/handlers";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { pgDb } from "../helpers/pg-db";
import { Browser } from "../helpers/browser";

const SECRET = "test-secret-".padEnd(48, "x");
let db: TestDatabase;

beforeAll(async () => {
  process.env.VISITOR_COOKIE_SECRET = SECRET;
  db = await createTestDatabase();
  setDbForTesting(pgDb(db.pool("service_role", 40)));
});
afterAll(async () => {
  setDbForTesting(null);
  await db.drop();
});

const history = (query = "", ip = "10.9.9.9") =>
  handleHistory(new Request(`http://localhost:3000/api/history${query}`, { headers: { "x-forwarded-for": ip } }));

describe("GET /api/history", () => {
  it("is honestly empty before anyone has watered", async () => {
    const res = await history();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      slug: "save-the-plant",
      totalWaterings: 0,
      totalVisitors: 0,
      days: [],
      milestones: [],
    });
  });

  it("reflects real waterings made through the API", async () => {
    await Promise.all(Array.from({ length: 26 }, () => new Browser().water()));
    const body = await (await history()).json();

    expect(body.totalWaterings).toBe(26);
    expect(body.totalVisitors).toBe(26);
    expect(body.days).toEqual([{ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), waterings: 26, participants: 26 }]);
    expect(body.milestones).toEqual([
      { stage: 1, name: "Sprout", threshold: 25, reachedAt: expect.any(String) },
    ]);
  });

  it("is cacheable at the edge because it holds only aggregates", async () => {
    const res = await history();
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
  });

  it("never exposes visitor data", async () => {
    const text = JSON.stringify(await (await history()).json());
    expect(text).not.toMatch(/hash|visitor_|participant_id|request_id|cookie/i);
  });

  it.each(["?days=0", "?days=91", "?days=abc", "?days=1.5", "?days=-3"])("rejects %s with 400", async (q) => {
    const res = await history(q);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("rejects a malformed slug and 404s an unknown one", async () => {
    expect((await history("?slug=Bad Slug")).status).toBe(400);
    expect((await history("?slug=no-such-thing")).status).toBe(404);
  });

  it("answers 503 without leaking the reason when the database is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setDbForTesting({ rpc: async () => ({ data: null, error: { message: "host db.internal:5432 unreachable" } }) });
    try {
      const res = await history();
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).not.toContain("db.internal");
    } finally {
      setDbForTesting(pgDb(db.pool("service_role", 40)));
    }
  });

  it("is rate limited per IP", async () => {
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await history("", "198.51.100.200")).status;
    expect(last).toBe(429);
  });
});

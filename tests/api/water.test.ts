import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTesting, type Db } from "@/lib/db";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { pgDb } from "../helpers/pg-db";
import { Browser, type Reply } from "../helpers/browser";
import { ageEvents, eventCount, stateRow } from "../helpers/actions";

const SECRET = "test-secret-".padEnd(48, "x");

let db: TestDatabase;
let realDb: Db;
beforeAll(async () => {
  db = await createTestDatabase();
  realDb = pgDb(db.pool("service_role", 80));
});
afterAll(async () => {
  setDbForTesting(null);
  await db.drop();
});
beforeEach(() => {
  process.env.VISITOR_COOKIE_SECRET = SECRET;
  setDbForTesting(realDb);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/water: the happy path", () => {
  it("waters the plant, returns 201 and the updated global state", async () => {
    const b = new Browser();
    const r = await b.water({ requestId: randomUUID() });

    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body).toMatchObject({
      ok: true,
      duplicate: false,
      contributionNumber: expect.any(Number),
      experiment: {
        slug: "save-the-plant",
        totalWaterings: expect.any(Number),
        health: 70,
        stageName: "Seed",
        canWater: false,
      },
    });
    // The next-eligible time is ~24h away, from the server's clock.
    const next = new Date(r.body.experiment.nextEligibleAt).getTime();
    expect(next).toBeGreaterThan(Date.now() + 23.9 * 3600_000);
    expect(next).toBeLessThan(Date.now() + 24.1 * 3600_000);
  });

  it("works for a visitor whose very first request is the POST (cookie is issued)", async () => {
    const b = new Browser();
    const r = await b.water();
    expect(r.status).toBe(201);
    expect(r.setCookies[0]).toMatch(/^he_visitor=.*HttpOnly/);
  });

  it("GET afterwards reports the same state and a closed cooldown for that visitor", async () => {
    const b = new Browser();
    const posted = await b.water();
    const got = await b.get();

    expect(got.body.totalWaterings).toBe(posted.body.experiment.totalWaterings);
    expect(got.body.health).toBe(posted.body.experiment.health);
    expect(got.body.growthStage).toBe(posted.body.experiment.growthStage);
    expect(got.body.canWater).toBe(false);
    expect(got.body.nextEligibleAt).toBe(posted.body.experiment.nextEligibleAt);

    // Another visitor still can.
    expect((await new Browser().get()).body.canWater).toBe(true);
  });
});

describe("cooldown", () => {
  it("returns 429 with Retry-After and the exact next time, and adds nothing", async () => {
    const b = new Browser();
    const first = await b.water();
    expect(first.status).toBe(201);
    const before = await eventCount(db.admin);

    const second = await b.water();
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("cooldown");
    expect(second.body.nextEligibleAt).toBe(first.body.experiment.nextEligibleAt);
    expect(second.body.retryAfterSeconds).toBeGreaterThan(24 * 3600 - 60);
    expect(Number(second.headers.get("retry-after"))).toBe(second.body.retryAfterSeconds);
    expect(second.body.experiment.canWater).toBe(false);
    expect(await eventCount(db.admin)).toBe(before);
  });

  it("lets the same browser water again after 24h", async () => {
    const b = new Browser();
    await b.water();
    await ageEvents(db.admin, 25);
    const again = await b.water();
    expect(again.status).toBe(201);
  });

  it("survives cookie expiry: the browser's hint restores the identity and the cooldown", async () => {
    const b = new Browser({ hint: randomUUID() });
    expect((await b.water()).status).toBe(201);

    b.forgetCookie(); // cookie expired or cleared
    const r = await b.water();
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("cooldown");
    expect(r.setCookies).toHaveLength(1); // cookie re-issued gracefully
  });

  it("a forged cookie cannot impersonate another visitor", async () => {
    const victim = new Browser({ hint: randomUUID() });
    expect((await victim.water()).status).toBe(201);
    const victimId = victim.cookie!.split("=")[1].slice(0, 36);

    const attacker = new Browser();
    attacker.cookie = `he_visitor=${victimId}.${"B".repeat(43)}`;
    const before = await eventCount(db.admin);
    const r = await attacker.water();

    // The attacker gets a fresh identity of their own, not the victim's cooldown...
    expect(r.status).toBe(201);
    expect(r.setCookies[0]).not.toContain(victimId);
    expect(await eventCount(db.admin)).toBe(before + 1);
    // ...and the victim's own cooldown is untouched.
    expect((await victim.water()).status).toBe(429);
  });
});

describe("duplicate submissions", () => {
  it("replaying the same requestId returns 200 duplicate and records nothing", async () => {
    const b = new Browser();
    const requestId = randomUUID();
    const first = await b.water({ requestId });
    const before = await eventCount(db.admin);

    const replay = await b.water({ requestId });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.contributionNumber).toBe(first.body.contributionNumber);
    expect(await eventCount(db.admin)).toBe(before);
  });
});

describe("request validation", () => {
  const cases: Array<[string, () => Promise<Reply>, number, string]> = [
    ["invalid JSON", () => new Browser().postRaw("{nope", { "content-type": "application/json" }), 400, "invalid_json"],
    ["empty body", () => new Browser().postRaw("", { "content-type": "application/json" }), 400, "invalid_json"],
    ["JSON array body", () => new Browser().water([1, 2]), 400, "invalid_request"],
    ["JSON string body", () => new Browser().postRaw('"hi"', { "content-type": "application/json" }), 400, "invalid_request"],
    ["non-JSON content type", () => new Browser().postRaw("{}", { "content-type": "text/plain" }), 415, "unsupported_media_type"],
    ["form content type", () => new Browser().postRaw("a=b", { "content-type": "application/x-www-form-urlencoded" }), 415, "unsupported_media_type"],
    ["non-UUID requestId", () => new Browser().water({ requestId: "12345" }), 400, "invalid_request"],
    ["numeric requestId", () => new Browser().water({ requestId: 7 }), 400, "invalid_request"],
    ["non-string turnstileToken", () => new Browser().water({ turnstileToken: 42 }), 400, "invalid_request"],
    ["malformed slug", () => new Browser().water({ slug: "Robert'); DROP TABLE x;--" }), 400, "invalid_slug"],
    ["oversized body", () => new Browser().water({ pad: "x".repeat(5000) }), 413, "payload_too_large"],
  ];

  it.each(cases)("%s → %i %s", async (_name, run, status, code) => {
    const before = await eventCount(db.admin);
    const r = await run();
    expect(r.status).toBe(status);
    expect(r.body.error.code).toBe(code);
    expect(await eventCount(db.admin)).toBe(before);
  });

  it("unknown experiment → 404", async () => {
    const r = await new Browser().water({ slug: "no-such-experiment" });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("not_found");
  });

  it("paused experiment → 409", async () => {
    await db.admin.query("update public.experiments set status = 'paused'");
    try {
      const r = await new Browser().water();
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("experiment_inactive");
    } finally {
      await db.admin.query("update public.experiments set status = 'active'");
    }
  });

  it("only POST is supported by the route module", async () => {
    const route = await import("@/app/api/water/route");
    expect(Object.keys(route).sort()).toEqual(["POST"]);
  });
});

describe("cross-site protection", () => {
  it("rejects a foreign Origin with 403 and records nothing", async () => {
    const before = await eventCount(db.admin);
    const r = await new Browser().water({}, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("forbidden_origin");
    expect(await eventCount(db.admin)).toBe(before);
  });

  it("rejects an unparseable Origin", async () => {
    const r = await new Browser().water({}, { origin: "null" });
    expect(r.status).toBe(403);
  });

  it("rejects Sec-Fetch-Site: cross-site when there is no Origin", async () => {
    const b = new Browser();
    const res = await b.postRaw("{}", {
      "content-type": "application/json",
      origin: "",
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
  });

  it("accepts the site's own origin", async () => {
    const r = await new Browser().water({}, { origin: "http://localhost:3000" });
    expect(r.status).toBe(201);
  });
});

describe("rate limiting", () => {
  it("allows 12 attempts per minute per IP, then answers 429 rate_limited", async () => {
    const ip = "203.0.113.77";
    const results = [];
    for (let i = 0; i < 13; i++) results.push(await new Browser({ ip }).water());

    expect(results.slice(0, 12).every((r) => r.body.error?.code !== "rate_limited")).toBe(true);
    const last = results[12];
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("rate_limited");
    expect(last.headers.get("retry-after")).toBe("60");
  });

  it("does not count a different IP against that limit", async () => {
    const r = await new Browser({ ip: "203.0.113.78" }).water();
    expect(r.status).toBe(201);
  });

  it("fails open if the limiter itself is down (the atomic cooldown still protects state)", async () => {
    setDbForTesting({
      rpc: (fn, args) =>
        fn === "hit_rate_limit"
          ? Promise.resolve({ data: null, error: { message: "limiter down" } })
          : realDb.rpc(fn, args),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await new Browser().water();
    expect(r.status).toBe(201);
  });

  it("rate limits the read endpoint too (per instance)", async () => {
    const ip = "198.51.100.5";
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await new Browser({ ip }).get()).status;
    expect(last).toBe(429);
  });
});

describe("Cloudflare Turnstile", () => {
  const enable = () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "ts-secret-value");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "ts-site-key");
  };
  const mockVerify = (success: boolean) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("is not required when it is not configured", async () => {
    const r = await new Browser().water();
    expect(r.status).toBe(201);
  });

  it("is not required when only one of the two keys is set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "only-secret");
    const r = await new Browser().water();
    expect(r.status).toBe(201);
  });

  it("rejects a missing token with 403 when enabled", async () => {
    enable();
    const fetchMock = mockVerify(true);
    const before = await eventCount(db.admin);
    const r = await new Browser().water({});
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("turnstile_failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await eventCount(db.admin)).toBe(before);
  });

  it("rejects a token Cloudflare says is invalid", async () => {
    enable();
    mockVerify(false);
    const before = await eventCount(db.admin);
    const r = await new Browser().water({ turnstileToken: "bad-token" });
    expect(r.status).toBe(403);
    expect(await eventCount(db.admin)).toBe(before);
  });

  it("accepts a valid token and sends the secret only to Cloudflare, never to the client", async () => {
    enable();
    const fetchMock = mockVerify(true);
    const b = new Browser({ ip: "203.0.113.90" });
    const r = await b.water({ turnstileToken: "good-token" });

    expect(r.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const form = init.body as URLSearchParams;
    expect(form.get("secret")).toBe("ts-secret-value");
    expect(form.get("response")).toBe("good-token");
    expect(form.get("remoteip")).toBe("203.0.113.90");
    expect(JSON.stringify(r.body)).not.toContain("ts-secret-value");
  });

  it("reports 503 (try again) rather than 403 when Cloudflare is unreachable", async () => {
    enable();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    const r = await new Browser().water({ turnstileToken: "whatever" });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("captcha_unavailable");
  });

  it("does not enforce Turnstile on the read endpoint", async () => {
    enable();
    mockVerify(false);
    expect((await new Browser().get()).status).toBe(200);
  });
});

describe("failure handling", () => {
  it("returns 503 with the cookie intact when the database is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setDbForTesting({
      rpc: async (fn) =>
        fn === "hit_rate_limit"
          ? { data: true as never, error: null }
          : { data: null, error: { message: "FATAL: password authentication failed for user svc" } },
    });
    const r = await new Browser().water();
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("temporarily_unavailable");
    expect(JSON.stringify(r.body)).not.toMatch(/password|FATAL|svc/);
    expect(r.setCookies).toHaveLength(1);
  });

  it("returns a generic 500 when the database returns an unexpected result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setDbForTesting({
      rpc: async (fn) =>
        fn === "hit_rate_limit"
          ? { data: true as never, error: null }
          : { data: { ok: false, code: "something_new" } as never, error: null },
    });
    const r = await new Browser().water();
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("server_error");
    expect(JSON.stringify(r.body)).not.toContain("something_new");
  });

  it("returns a generic 500 when the cookie secret is missing or too short", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.VISITOR_COOKIE_SECRET = "short";
    const r = await new Browser().water();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/VISITOR_COOKIE_SECRET|32/);
  });
});

describe("concurrency through the HTTP layer", () => {
  it("25 independent browsers watering at once → 25 × 201, total +25, state consistent", async () => {
    const before = (await stateRow(db.admin)).total;
    const browsers = Array.from({ length: 25 }, () => new Browser());
    const replies = await Promise.all(browsers.map((b) => b.water()));

    expect(replies.every((r) => r.status === 201)).toBe(true);
    const numbers = new Set(replies.map((r) => r.body.contributionNumber));
    expect(numbers.size).toBe(25);

    const after = await stateRow(db.admin);
    expect(after.total).toBe(before + 25);
    expect(after.total).toBe(await eventCount(db.admin));
    const got = await new Browser().get();
    expect(got.body.totalWaterings).toBe(after.total);
    expect(got.body.growthStage).toBe(after.growth_stage);
  });

  it("20 simultaneous requests from ONE visitor → exactly one succeeds", async () => {
    const b = new Browser();
    await b.get(); // obtain the signed cookie first
    const before = await eventCount(db.admin);

    // Distinct IPs so the IP rate limit is not what rejects them.
    const replies = await Promise.all(
      Array.from({ length: 20 }, (_, i) => b.water({}, { "x-forwarded-for": `192.0.2.${i + 1}` })),
    );
    const created = replies.filter((r) => r.status === 201);
    const cooldown = replies.filter((r) => r.status === 429 && r.body.error.code === "cooldown");
    expect(created).toHaveLength(1);
    expect(cooldown).toHaveLength(19);
    expect(await eventCount(db.admin)).toBe(before + 1);
  });
});

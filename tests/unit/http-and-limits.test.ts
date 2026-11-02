import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, HttpError, isAllowedOrigin, parseSlug, readJsonObject } from "@/lib/http";
import { siteUrl, turnstileConfig, visitorSecret } from "@/lib/env";
import { MemoryRateLimiter } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";

afterEach(() => vi.unstubAllEnvs());

describe("clientIp", () => {
  const ip = (h: Record<string, string>) => clientIp(new Request("http://x.test/", { headers: h }));
  it("uses the first hop of x-forwarded-for", () => {
    expect(ip({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" })).toBe("203.0.113.5");
  });
  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(ip({ "x-real-ip": "198.51.100.2" })).toBe("198.51.100.2");
    expect(ip({})).toBe("unknown");
  });
  it("bounds the length of a hostile header", () => {
    expect(ip({ "x-forwarded-for": "9".repeat(500) }).length).toBeLessThanOrEqual(64);
  });
});

describe("isAllowedOrigin", () => {
  const check = (h: Record<string, string>) =>
    isAllowedOrigin(new Request("http://localhost:3000/api/water", { method: "POST", headers: h }));

  it("allows the site's own origin", () => {
    expect(check({ origin: "http://localhost:3000" })).toBe(true);
  });
  it("allows the origin matching the request host (preview deployments)", () => {
    expect(check({ origin: "https://preview-abc.vercel.app", host: "preview-abc.vercel.app" })).toBe(true);
  });
  it("allows the configured public site URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://plant.example");
    expect(check({ origin: "https://plant.example", host: "internal.local" })).toBe(true);
  });
  it("rejects a foreign or malformed origin", () => {
    expect(check({ origin: "https://evil.example" })).toBe(false);
    expect(check({ origin: "null" })).toBe(false);
    expect(check({ origin: "http://localhost:3001" })).toBe(false);
  });
  it("without an Origin, defers to Sec-Fetch-Site", () => {
    expect(check({})).toBe(true); // curl / server-to-server
    expect(check({ "sec-fetch-site": "same-origin" })).toBe(true);
    expect(check({ "sec-fetch-site": "cross-site" })).toBe(false);
  });
});

describe("readJsonObject", () => {
  const post = (body: string, type = "application/json", extra: Record<string, string> = {}) =>
    new Request("http://x.test/", { method: "POST", body, headers: { "content-type": type, ...extra } });

  it("parses an object", async () => {
    expect(await readJsonObject(post('{"a":1}'))).toEqual({ a: 1 });
  });
  it("accepts a charset parameter", async () => {
    expect(await readJsonObject(post("{}", "application/json; charset=utf-8"))).toEqual({});
  });
  // Factories: a Request body can only be read once, so build a fresh one per case.
  it.each<[string, () => Request, number]>([
    ["wrong type", () => post("{}", "text/plain"), 415],
    ["bad JSON", () => post("{"), 400],
    ["array", () => post("[]"), 400],
    ["null", () => post("null"), 400],
    ["oversized", () => post(JSON.stringify({ p: "x".repeat(5000) })), 413],
    ["oversized by declared length", () => post("{}", "application/json", { "content-length": "999999" }), 413],
  ])("rejects %s", async (_n, makeRequest, status) => {
    const err = await readJsonObject(makeRequest()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
  });
});

describe("parseSlug", () => {
  it("defaults when absent", () => {
    for (const v of [undefined, null, ""]) expect(parseSlug(v, "save-the-plant")).toBe("save-the-plant");
  });
  it("accepts well-formed slugs", () => {
    expect(parseSlug("other-experiment-2", "x")).toBe("other-experiment-2");
  });
  it.each(["UPPER", "has space", "../x", "a--b", "-lead", "trail-", "x".repeat(65), "a_b"])("rejects %s", (v) => {
    expect(() => parseSlug(v, "x")).toThrow(HttpError);
  });
  it("rejects non-strings", () => {
    expect(() => parseSlug(123, "x")).toThrow(HttpError);
  });
});

describe("env helpers", () => {
  it("siteUrl prefers the explicit URL, strips trailing slashes, then Vercel, then localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://plant.example///");
    expect(siteUrl()).toBe("https://plant.example");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "plant.vercel.app");
    expect(siteUrl()).toBe("https://plant.vercel.app");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "plant-git-abc.vercel.app");
    expect(siteUrl()).toBe("https://plant-git-abc.vercel.app");
    vi.stubEnv("VERCEL_URL", "");
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("visitorSecret demands a long enough secret", () => {
    vi.stubEnv("VISITOR_COOKIE_SECRET", "");
    expect(() => visitorSecret()).toThrow(/VISITOR_COOKIE_SECRET/);
    vi.stubEnv("VISITOR_COOKIE_SECRET", "too-short");
    expect(() => visitorSecret()).toThrow(/at least 32/);
    vi.stubEnv("VISITOR_COOKIE_SECRET", "x".repeat(32));
    expect(visitorSecret()).toHaveLength(32);
  });

  it("turnstile is on only when both keys are present", () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(turnstileConfig()).toBeNull();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "s");
    expect(turnstileConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "k");
    expect(turnstileConfig()).toEqual({ secret: "s" });
  });
});

describe("MemoryRateLimiter", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const l = new MemoryRateLimiter(() => 0);
    expect([1, 2, 3, 4].map(() => l.hit("k", 3, 60))).toEqual([true, true, true, false]);
  });

  it("opens a new window after it elapses", () => {
    let now = 0;
    const l = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) l.hit("k", 2, 60);
    expect(l.hit("k", 2, 60)).toBe(false);
    now = 60_000;
    expect(l.hit("k", 2, 60)).toBe(true);
  });

  it("tracks keys independently", () => {
    const l = new MemoryRateLimiter(() => 0);
    expect(l.hit("a", 1, 60)).toBe(true);
    expect(l.hit("b", 1, 60)).toBe(true);
    expect(l.hit("a", 1, 60)).toBe(false);
  });

  it("sweeps expired buckets so memory stays bounded", () => {
    let now = 0;
    const l = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 5001; i++) l.hit(`k${i}`, 1, 1);
    now = 10_000;
    l.hit("trigger", 1, 1);
    // After the sweep, an expired key is treated as brand new.
    expect(l.hit("k0", 1, 1)).toBe(true);
  });
});

describe("verifyTurnstile", () => {
  const okFetch = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it.each([undefined, null, "", 123, "x".repeat(2049)])("rejects an unusable token (%s) without calling Cloudflare", async (t) => {
    const f = okFetch({ success: true });
    expect(await verifyTurnstile(t, "s", undefined, f)).toEqual({ ok: false, reason: "missing" });
    expect(f).not.toHaveBeenCalled();
  });

  it("accepts a token Cloudflare approves", async () => {
    expect(await verifyTurnstile("tok", "s", "1.2.3.4", okFetch({ success: true }))).toEqual({ ok: true });
  });

  it("rejects a token Cloudflare refuses", async () => {
    expect(await verifyTurnstile("tok", "s", "1.2.3.4", okFetch({ success: false }))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("treats a non-200 or a network error as 'unavailable', not 'invalid'", async () => {
    expect(await verifyTurnstile("tok", "s", undefined, okFetch({}, 500))).toEqual({ ok: false, reason: "unavailable" });
    const boom = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "s", undefined, boom)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("omits remoteip when the address is unknown", async () => {
    const f = okFetch({ success: true });
    await verifyTurnstile("tok", "s", "unknown", f);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.body as URLSearchParams).has("remoteip")).toBe(false);
  });
});

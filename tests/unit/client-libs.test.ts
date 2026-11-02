import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeProps } from "@/lib/client/analytics";
import { describeFailure, fetchExperiment, postWater, serverNow } from "@/lib/client/api";
import { formatCountdown, formatCount, formatDay, timeAgo } from "@/lib/client/format";
import { getVisitorHint, randomUuid } from "@/lib/client/visitor-hint";
import { SHARE_TEXT, shareLink, type ShareEnv } from "@/lib/share";

describe("format helpers", () => {
  it("formats counts with thousands separators and never goes negative", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(-5)).toBe("0");
    expect(formatCount(2.6)).toBe("3");
  });

  it("formats countdowns and rounds partial seconds up so it never shows 0 early", () => {
    expect(formatCountdown(24 * 3600_000)).toBe("24h 00m 00s");
    expect(formatCountdown(23 * 3600_000 + 42 * 60_000 + 1_000)).toBe("23h 42m 01s");
    expect(formatCountdown(61_000)).toBe("1m 01s");
    expect(formatCountdown(900)).toBe("1s");
    expect(formatCountdown(0)).toBe("0s");
    expect(formatCountdown(-5000)).toBe("0s");
  });

  it("describes elapsed time in plain words", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    expect(timeAgo("2026-11-03T11:59:58Z", now)).toBe("just now");
    expect(timeAgo("2026-11-03T11:59:15Z", now)).toBe("45s ago");
    expect(timeAgo("2026-11-03T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-11-03T07:00:00Z", now)).toBe("5h ago");
    expect(timeAgo("2026-11-02T08:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-10-30T12:00:00Z", now)).toBe("4 days ago");
    expect(timeAgo("2026-11-03T13:00:00Z", now)).toBe("just now"); // clock skew: future timestamps clamp
  });

  it("formats UTC calendar days without time-zone drift", () => {
    expect(formatDay("2026-11-03")).toBe("3 Nov");
    expect(formatDay("2026-01-01")).toBe("1 Jan");
  });
});

describe("analytics property filter", () => {
  it("drops anything that could identify a visitor", () => {
    const clean = sanitizeProps({
      stage: 3,
      stage_name: "Growing plant",
      can_water: true,
      visitor_hash: "abc",
      visitorId: "abc",
      turnstile_token: "tok",
      cookie: "he_visitor=1",
      user_email: "a@b.c",
      ip: "1.2.3.4",
      participant_id: "p",
      secret_thing: "x",
    });
    expect(clean).toEqual({ stage: 3, stage_name: "Growing plant", can_water: true });
  });

  it("drops null/undefined, truncates long strings and ignores non-primitives", () => {
    const clean = sanitizeProps({
      a: null,
      b: undefined,
      c: "x".repeat(500),
      d: { nested: true } as unknown as string,
    });
    expect(clean).toEqual({ c: "x".repeat(120) });
    expect(sanitizeProps(undefined)).toEqual({});
  });
});

describe("visitor hint", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("creates a v4 uuid once and then keeps returning the same one", () => {
    const store = memory();
    const first = getVisitorHint(store);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getVisitorHint(store)).toBe(first);
  });

  it("replaces a corrupted stored value instead of sending it", () => {
    const store = memory();
    store.data.set("he_visitor_hint", "not-a-uuid");
    const hint = getVisitorHint(store);
    expect(hint).not.toBe("not-a-uuid");
    expect(hint).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns null when storage is unavailable or throws (private mode)", () => {
    expect(getVisitorHint(null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(getVisitorHint(broken)).toBeNull();
  });

  it("generates distinct uuids", () => {
    expect(new Set(Array.from({ length: 50 }, randomUuid)).size).toBe(50);
  });
});

describe("share", () => {
  const url = "https://example.test/c/42";

  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    await expect(shareLink({ url }, { share, writeText })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url, text: SHARE_TEXT }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses the exact share text from the brief", () => {
    expect(SHARE_TEXT).toBe(
      "I just watered a plant with strangers around the world. We're trying to keep it alive. Join the experiment!",
    );
  });

  it("falls back to copying the link when the browser has no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareLink({ url }, { writeText })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("falls back to copying when canShare says the data is unsupported", async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareLink({ url }, { share, canShare: () => false, writeText })).resolves.toBe("copied");
    expect(share).not.toHaveBeenCalled();
  });

  it("treats closing the share sheet as a cancel, not an error, and does not copy", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" }));
    const writeText = vi.fn();
    await expect(shareLink({ url }, { share, writeText })).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies when the share sheet fails for another reason", async () => {
    const share = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareLink({ url }, { share, writeText })).resolves.toBe("copied");
  });

  it("reports failure when nothing works", async () => {
    const env: ShareEnv = { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    await expect(shareLink({ url }, env)).resolves.toBe("failed");
    await expect(shareLink({ url }, {})).resolves.toBe("failed");
  });
});

describe("describeFailure", () => {
  const http = (code: string, status = 400) => ({ kind: "http" as const, status, code, body: {} });

  it("keeps the idempotency key after a network failure (the request may have landed)", () => {
    const f = describeFailure({ kind: "network" });
    expect(f.keepRequestId).toBe(true);
    expect(f.message).toMatch(/offline/i);
  });

  it("gives every known server code a human message", () => {
    for (const code of ["cooldown", "rate_limited", "turnstile_failed", "captcha_unavailable", "temporarily_unavailable", "experiment_inactive", "forbidden_origin"]) {
      const f = describeFailure(http(code));
      expect(f.message.length).toBeGreaterThan(10);
      expect(f.message).not.toMatch(/undefined|\{|code/i);
    }
  });

  it("resets the one-time captcha token when verification fails", () => {
    expect(describeFailure(http("turnstile_failed", 403)).resetCaptcha).toBe(true);
  });

  it("retries the same request id on server errors but not on client errors", () => {
    expect(describeFailure(http("unknown", 500)).keepRequestId).toBe(true);
    expect(describeFailure(http("unknown", 400)).keepRequestId).toBe(false);
  });
});

describe("API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never throws: a failed fetch becomes {kind:'network'}", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchExperiment()).resolves.toEqual({ kind: "network" });
    await expect(postWater({ requestId: "r" })).resolves.toEqual({ kind: "network" });
  });

  it("maps JSON error bodies onto http results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "cooldown", message: "wait" }, retryAfterSeconds: 60 }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const result = await postWater({ requestId: "r" });
    expect(result).toMatchObject({ kind: "http", status: 429, code: "cooldown" });
  });

  it("survives an empty or non-JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 })));
    await expect(fetchExperiment()).resolves.toMatchObject({ kind: "http", status: 502, code: "unknown" });
  });

  it("learns the server clock from the Date header so countdowns survive a wrong device clock", async () => {
    const serverTime = Date.now() + 3 * 3600_000; // device clock is 3 hours behind
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", { status: 200, headers: { date: new Date(serverTime).toUTCString() } }),
      ),
    );
    await fetchExperiment();
    expect(Math.abs(serverNow() - (Date.now() + 3 * 3600_000))).toBeLessThan(2500);
  });

  it("sends the visitor hint header only when storage is available (none in node)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchExperiment();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVisitorCookie,
  hashIp,
  hashVisitorId,
  isVisitorId,
  readCookie,
  resolveVisitor,
  serializeVisitorCookie,
  signVisitorId,
  verifyVisitorCookie,
  VISITOR_COOKIE,
  VISITOR_HINT_HEADER,
} from "@/lib/visitor";

const SECRET = "unit-test-secret-".padEnd(48, "s");
const OTHER = "a-completely-different-secret-".padEnd(48, "o");

afterEach(() => vi.unstubAllEnvs());

describe("isVisitorId", () => {
  it("accepts a v4 UUID in either case", () => {
    const id = randomUUID();
    expect(isVisitorId(id)).toBe(true);
    expect(isVisitorId(id.toUpperCase())).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["non-v4 version nibble", "123e4567-e89b-12d3-a456-426614174000"],
    ["bad variant", "123e4567-e89b-42d3-c456-426614174000"],
    ["too short", "123e4567-e89b-42d3-a456"],
    ["with whitespace", " " + randomUUID()],
    ["sql-ish", "'; drop table participants;--"],
  ])("rejects %s", (_name, value) => {
    expect(isVisitorId(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const v of [null, undefined, 42, {}, [], true]) expect(isVisitorId(v)).toBe(false);
  });
});

describe("signing and verification", () => {
  it("round-trips a valid cookie", () => {
    const id = randomUUID();
    expect(verifyVisitorCookie(signVisitorId(id, SECRET), SECRET)).toBe(id);
  });

  it("normalises the id to lower case", () => {
    const id = randomUUID();
    expect(verifyVisitorCookie(signVisitorId(id.toUpperCase(), SECRET), SECRET)).toBe(id);
  });

  it("rejects a cookie signed with another secret", () => {
    expect(verifyVisitorCookie(signVisitorId(randomUUID(), OTHER), SECRET)).toBeNull();
  });

  it("rejects a tampered identifier", () => {
    const signed = signVisitorId(randomUUID(), SECRET);
    const other = randomUUID();
    expect(verifyVisitorCookie(other + signed.slice(36), SECRET)).toBeNull();
  });

  it("rejects a tampered signature, even a single flipped character", () => {
    const signed = signVisitorId(randomUUID(), SECRET);
    const last = signed.at(-1) === "A" ? "B" : "A";
    expect(verifyVisitorCookie(signed.slice(0, -1) + last, SECRET)).toBeNull();
  });

  it("accepts exactly one string per signature at every position (no non-canonical base64 variants)", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let run = 0; run < 20; run++) {
      const id = randomUUID();
      const signed = signVisitorId(id, SECRET);
      const accepted = [...alphabet].filter((ch) => verifyVisitorCookie(signed.slice(0, -1) + ch, SECRET) !== null);
      expect(accepted).toEqual([signed.at(-1)]);
    }
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["id only", randomUUID()],
    ["wrong separator", randomUUID() + ":" + "A".repeat(43)],
    ["short signature", randomUUID() + "." + "A".repeat(42)],
    ["long signature", randomUUID() + "." + "A".repeat(44)],
    ["padded base64", randomUUID() + "." + "A".repeat(42) + "="],
    ["illegal characters", randomUUID() + "." + "!".repeat(43)],
  ])("rejects malformed input: %s", (_name, raw) => {
    expect(verifyVisitorCookie(raw as string | null | undefined, SECRET)).toBeNull();
  });
});

describe("hashing", () => {
  it("produces a stable 64-char hex digest that is not the identifier", () => {
    const id = randomUUID();
    const h = hashVisitorId(id, SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashVisitorId(id, SECRET));
    expect(h).not.toContain(id.replace(/-/g, ""));
  });

  it("differs per visitor and per secret", () => {
    const a = randomUUID();
    expect(hashVisitorId(a, SECRET)).not.toBe(hashVisitorId(randomUUID(), SECRET));
    expect(hashVisitorId(a, SECRET)).not.toBe(hashVisitorId(a, OTHER));
  });

  it("is case-insensitive about the identifier", () => {
    const a = randomUUID();
    expect(hashVisitorId(a, SECRET)).toBe(hashVisitorId(a.toUpperCase(), SECRET));
  });

  it("uses a different derivation than the cookie signature (no cross-use)", () => {
    const id = randomUUID();
    const signature = signVisitorId(id, SECRET).slice(37);
    const hashB64 = Buffer.from(hashVisitorId(id, SECRET), "hex").toString("base64url");
    expect(signature).not.toBe(hashB64);
  });

  it("hashes IP addresses without storing them", () => {
    const h = hashIp("203.0.113.9", SECRET);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(hashIp("203.0.113.9", SECRET)).toBe(h);
    expect(hashIp("203.0.113.10", SECRET)).not.toBe(h);
  });
});

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(readCookie("a=1; he_visitor=xyz; b=2", "he_visitor")).toBe("xyz");
  });
  it("handles quoted values and '=' inside values", () => {
    expect(readCookie('he_visitor="abc=="', "he_visitor")).toBe("abc==");
  });
  it("returns undefined when absent or the header is missing", () => {
    expect(readCookie("a=1", "he_visitor")).toBeUndefined();
    expect(readCookie(null, "he_visitor")).toBeUndefined();
  });
  it("does not match a cookie whose name merely contains the target", () => {
    expect(readCookie("xhe_visitor=nope; he_visitor_2=nope", "he_visitor")).toBeUndefined();
  });
});

describe("cookie attributes", () => {
  it("is HttpOnly, SameSite=Lax, Path=/, with a long Max-Age", () => {
    const c = serializeVisitorCookie("value", { secure: false });
    expect(c).toContain("he_visitor=value");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toMatch(/Max-Age=34560000/);
    expect(c).not.toContain("Secure");
  });

  it("adds Secure when requested", () => {
    expect(serializeVisitorCookie("v", { secure: true })).toContain("Secure");
  });

  it("applyVisitorCookie sets Secure only in production", () => {
    const visitor = resolveVisitor(new Request("http://x.test/"), SECRET);

    vi.stubEnv("NODE_ENV", "production");
    const prod = applyVisitorCookie(new Response(), visitor, SECRET);
    expect(prod.headers.getSetCookie()[0]).toContain("Secure");

    vi.stubEnv("NODE_ENV", "development");
    const dev = applyVisitorCookie(new Response(), visitor, SECRET);
    expect(dev.headers.getSetCookie()[0]).not.toContain("Secure");
  });

  it("applyVisitorCookie does nothing when no cookie needs issuing", () => {
    const id = randomUUID();
    const req = new Request("http://x.test/", { headers: { cookie: `${VISITOR_COOKIE}=${signVisitorId(id, SECRET)}` } });
    const visitor = resolveVisitor(req, SECRET);
    expect(applyVisitorCookie(new Response(), visitor, SECRET).headers.getSetCookie()).toHaveLength(0);
  });
});

describe("resolveVisitor", () => {
  const req = (headers: Record<string, string> = {}) => new Request("http://x.test/", { headers });

  it("trusts a validly signed cookie and does not re-issue it", () => {
    const id = randomUUID();
    const v = resolveVisitor(req({ cookie: `${VISITOR_COOKIE}=${signVisitorId(id, SECRET)}` }), SECRET);
    expect(v).toMatchObject({ id, source: "cookie", issueCookie: false, hash: hashVisitorId(id, SECRET) });
  });

  it("prefers the cookie over a conflicting hint", () => {
    const id = randomUUID();
    const v = resolveVisitor(
      req({ cookie: `${VISITOR_COOKIE}=${signVisitorId(id, SECRET)}`, [VISITOR_HINT_HEADER]: randomUUID() }),
      SECRET,
    );
    expect(v.id).toBe(id);
    expect(v.source).toBe("cookie");
  });

  it("falls back to the hint when the cookie is missing or invalid", () => {
    const hint = randomUUID();
    const missing = resolveVisitor(req({ [VISITOR_HINT_HEADER]: hint }), SECRET);
    expect(missing).toMatchObject({ id: hint, source: "hint", issueCookie: true });

    const forged = resolveVisitor(
      req({ cookie: `${VISITOR_COOKIE}=${randomUUID()}.${"A".repeat(43)}`, [VISITOR_HINT_HEADER]: hint }),
      SECRET,
    );
    expect(forged).toMatchObject({ id: hint, source: "hint" });
  });

  it("mints a new identity when there is no usable cookie or hint", () => {
    const a = resolveVisitor(req(), SECRET);
    const b = resolveVisitor(req({ [VISITOR_HINT_HEADER]: "garbage" }), SECRET);
    expect(a.source).toBe("new");
    expect(b.source).toBe("new");
    expect(a.id).not.toBe(b.id);
    expect(isVisitorId(a.id)).toBe(true);
  });
});

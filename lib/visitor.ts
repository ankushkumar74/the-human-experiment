import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Anonymous visitor identity.
 *
 * - The browser generates a random UUID (v4) and keeps it in localStorage as a
 *   *hint* (header `x-visitor-hint`). A hint is never trusted on its own.
 * - The server turns an acceptable identifier into a signed, HTTP-only cookie
 *   `<uuid>.<HMAC signature>`. Only a cookie whose signature verifies against
 *   the server-side secret is trusted afterwards, so a client cannot forge or
 *   switch to somebody else's identity by editing the cookie.
 * - Before anything is persisted the identifier is hashed again with a
 *   different HMAC purpose label. The database never sees the raw identifier.
 *
 * Honest limitation (also stated in the privacy page): this identifies a
 * browser/device, not a human. Clearing storage or using another browser yields
 * a new identity. Rate limiting and optional Turnstile reduce abuse; they do
 * not make this "one human, one vote".
 */

export const VISITOR_COOKIE = "he_visitor";
export const VISITOR_HINT_HEADER = "x-visitor-hint";
/** 400 days is the longest lifetime browsers will honour. */
export const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, no padding

export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function mac(secret: string, purpose: string, value: string): Buffer {
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest();
}

export function signVisitorId(id: string, secret: string): string {
  const normalised = id.toLowerCase();
  return `${normalised}.${mac(secret, "cookie", normalised).toString("base64url")}`;
}

/** Returns the visitor id if (and only if) the cookie's signature is valid. */
export function verifyVisitorCookie(raw: string | null | undefined, secret: string): string | null {
  if (!raw || raw.length !== 36 + 1 + 43) return null;
  const id = raw.slice(0, 36);
  const separator = raw[36];
  const signature = raw.slice(37);
  if (separator !== "." || !isVisitorId(id) || !SIGNATURE.test(signature)) return null;

  const given = Buffer.from(signature, "base64url");
  const expected = mac(secret, "cookie", id.toLowerCase());
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id.toLowerCase();
}

/** 64-char hex digest stored in the database in place of the identifier. */
export function hashVisitorId(id: string, secret: string): string {
  return mac(secret, "visitor", id.toLowerCase()).toString("hex");
}

/** Hash of an IP address, for rate-limit keys. Raw IPs are never stored. */
export function hashIp(ip: string, secret: string): string {
  return mac(secret, "ip", ip).toString("hex").slice(0, 32);
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
  return undefined;
}

export function serializeVisitorCookie(signedValue: string, opts: { secure: boolean }): string {
  return [
    `${VISITOR_COOKIE}=${signedValue}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}

export interface ResolvedVisitor {
  /** Raw identifier. Server-side only: never persisted, logged or returned. */
  id: string;
  /** What the database stores. */
  hash: string;
  /** True when the response must (re)issue the cookie. */
  issueCookie: boolean;
  source: "cookie" | "hint" | "new";
}

/**
 * Decides who the visitor is, in order of trust:
 *   1. a cookie with a valid signature,
 *   2. otherwise a well-formed UUID hint from the browser (cookie expired,
 *      cleared, or first request): the server signs it into a fresh cookie,
 *   3. otherwise a brand-new server-generated identity.
 */
export function resolveVisitor(request: Request, secret: string): ResolvedVisitor {
  const fromCookie = verifyVisitorCookie(readCookie(request.headers.get("cookie"), VISITOR_COOKIE), secret);
  if (fromCookie) {
    return { id: fromCookie, hash: hashVisitorId(fromCookie, secret), issueCookie: false, source: "cookie" };
  }

  const hint = request.headers.get(VISITOR_HINT_HEADER);
  if (isVisitorId(hint)) {
    const id = hint.toLowerCase();
    return { id, hash: hashVisitorId(id, secret), issueCookie: true, source: "hint" };
  }

  const id = randomUUID();
  return { id, hash: hashVisitorId(id, secret), issueCookie: true, source: "new" };
}

export function applyVisitorCookie(response: Response, visitor: ResolvedVisitor, secret: string): Response {
  if (visitor.issueCookie) {
    response.headers.append(
      "Set-Cookie",
      serializeVisitorCookie(signVisitorId(visitor.id, secret), {
        secure: process.env.NODE_ENV === "production",
      }),
    );
  }
  return response;
}

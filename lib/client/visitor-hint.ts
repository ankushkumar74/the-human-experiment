/**
 * The browser keeps a random UUID in localStorage and sends it as a *hint*
 * (x-visitor-hint). The server never trusts it by itself: it only turns it into
 * a signed, HTTP-only cookie. The hint exists so that if the cookie expires or
 * is cleared, the same browser keeps its identity (and its cooldown).
 *
 * If storage is blocked, we simply send no hint and the server issues a cookie.
 */

const KEY = "he_visitor_hint";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for insecure contexts / older browsers.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getVisitorHint(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): string | null {
  if (!storage) return null;
  try {
    const existing = storage.getItem(KEY);
    if (existing && UUID_V4.test(existing)) return existing;
    const fresh = randomUuid();
    storage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

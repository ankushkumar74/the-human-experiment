import "server-only";
import { siteUrl } from "@/lib/env";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return json({ error: { code, message }, ...extra }, status, headers);
}

/** Thrown by request parsing helpers; converted to a response by the handlers. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Best-effort client address. On Vercel the platform sets x-forwarded-for, so
 * the first hop is the real client. Only ever used (hashed) for rate limiting.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return request.headers.get("x-real-ip")?.trim().slice(0, 64) || "unknown";
}

/**
 * CSRF guard for state-changing requests. Browsers always send Origin on a
 * cross-origin POST; if it is present it must belong to this site. Requests
 * with no Origin (curl, server-to-server) are allowed unless the browser says
 * they are cross-site. The cookie is also SameSite=Lax, a second layer.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false;
    }
    const allowed = new Set<string>();
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (host) allowed.add(host);
    try {
      allowed.add(new URL(siteUrl()).host);
    } catch {
      /* ignore */
    }
    return allowed.has(originHost);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || ["same-origin", "same-site", "none"].includes(fetchSite);
}

const MAX_BODY_BYTES = 4096;

/** Reads a small JSON object body, rejecting anything else with a precise status. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Send the request as application/json.");
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_request", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseSlug(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || value.length > 64 || !SLUG.test(value)) {
    throw new HttpError(400, "invalid_slug", "Unknown experiment.");
  }
  return value;
}

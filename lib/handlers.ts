import "server-only";
import { getDb } from "@/lib/db";
import { MissingEnvError, turnstileConfig, visitorSecret } from "@/lib/env";
import {
  clientIp,
  errorResponse,
  HttpError,
  isAllowedOrigin,
  json,
  parseSlug,
  readJsonObject,
} from "@/lib/http";
import { toHistory, type HistoryRpc } from "@/lib/history";
import { DEFAULT_EXPERIMENT_SLUG } from "@/lib/plant";
import { dbRateLimit, LIMITS, readLimiter } from "@/lib/rate-limit";
import { toSnapshot, type GetStateRpc, type WaterRpc } from "@/lib/snapshot";
import { verifyTurnstile } from "@/lib/turnstile";
import { applyVisitorCookie, hashIp, isVisitorId, resolveVisitor } from "@/lib/visitor";

/**
 * Request handlers for the two public endpoints. They are plain
 * (Request) => Response functions so they can be exercised directly in tests;
 * the route files under app/api simply re-export them.
 *
 * They contain NO game logic. Cooldowns, counters, growth and health all live
 * in PostgreSQL (water_experiment / get_experiment_state). The handlers
 * identify the visitor, apply abuse protection, call the RPC, and translate its
 * result into an HTTP response.
 */

const TEMPORARILY_UNAVAILABLE = () =>
  errorResponse(503, "temporarily_unavailable", "The plant is having a moment. Please try again shortly.", {}, {
    "Retry-After": "5",
  });

function internalError(err: unknown): Response {
  if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
  // Log the reason server-side; never leak internals or configuration to the client.
  console.error("[api] unexpected error:", err instanceof MissingEnvError ? err.message : err);
  return errorResponse(500, "server_error", "Something went wrong on our side.");
}

// ── GET /api/experiment ───────────────────────────────────────────────────────

export async function handleGetExperiment(request: Request): Promise<Response> {
  // Read the request OUTSIDE the try/catch. During `next build`, Next throws a
  // deliberate "bail out of prerendering" signal here so this handler is never
  // prerendered; swallowing it in the catch-all below would defeat that.
  const url = new URL(request.url);

  try {
    const secret = visitorSecret();
    const slug = parseSlug(url.searchParams.get("slug"), DEFAULT_EXPERIMENT_SLUG);

    const ipKey = `get:${hashIp(clientIp(request), secret)}`;
    if (!readLimiter.hit(ipKey, LIMITS.readPerMinute, 60)) {
      return errorResponse(429, "rate_limited", "Too many requests. Please slow down.", {}, {
        "Retry-After": "30",
      });
    }

    const visitor = resolveVisitor(request, secret);
    const { data, error } = await getDb().rpc<GetStateRpc>("get_experiment_state", {
      p_slug: slug,
      p_visitor_hash: visitor.hash,
    });

    if (error || !data) {
      console.error("[api] get_experiment_state failed:", error?.message);
      return TEMPORARILY_UNAVAILABLE();
    }
    if (!data.ok || !data.state) {
      return data.code === "not_found"
        ? errorResponse(404, "not_found", "That experiment does not exist.")
        : internalError(new Error(`unexpected get_experiment_state code: ${data.code}`));
    }

    const snapshot = toSnapshot(data.state, data.can_water === true, data.next_eligible_at);
    return applyVisitorCookie(json(snapshot), visitor, secret);
  } catch (err) {
    return internalError(err);
  }
}

// ── POST /api/water ───────────────────────────────────────────────────────────

export async function handleWater(request: Request): Promise<Response> {
  try {
    if (!isAllowedOrigin(request)) {
      return errorResponse(403, "forbidden_origin", "Cross-site requests are not allowed.");
    }

    const body = await readJsonObject(request);

    const requestId = body.requestId;
    if (requestId !== undefined && !isVisitorId(requestId)) {
      throw new HttpError(400, "invalid_request", "requestId must be a UUID.");
    }
    const turnstileToken = body.turnstileToken;
    if (turnstileToken !== undefined && typeof turnstileToken !== "string") {
      throw new HttpError(400, "invalid_request", "turnstileToken must be a string.");
    }
    const slug = parseSlug(body.slug, DEFAULT_EXPERIMENT_SLUG);

    const secret = visitorSecret();
    const ip = clientIp(request);
    const db = getDb();

    // Request limit (shared across instances) before any expensive work.
    const withinLimit = await dbRateLimit(db, `water:${hashIp(ip, secret)}`, LIMITS.waterPerMinute, 60);
    if (!withinLimit) {
      return errorResponse(429, "rate_limited", "Too many attempts. Please wait a minute.", {}, {
        "Retry-After": "60",
      });
    }

    const visitor = resolveVisitor(request, secret);
    const withCookie = (res: Response) => applyVisitorCookie(res, visitor, secret);

    // Optional bot protection: enforced only when Turnstile is configured.
    const turnstile = turnstileConfig();
    if (turnstile) {
      const check = await verifyTurnstile(turnstileToken, turnstile.secret, ip);
      if (!check.ok) {
        if (check.reason === "unavailable") {
          return withCookie(
            errorResponse(503, "captcha_unavailable", "We could not verify you right now. Please try again.", {}, {
              "Retry-After": "5",
            }),
          );
        }
        return withCookie(
          errorResponse(403, "turnstile_failed", "Please complete the verification and try again."),
        );
      }
    }

    // The one atomic operation: lock, health, cooldown, insert, update, return.
    const { data, error } = await db.rpc<WaterRpc>("water_experiment", {
      p_slug: slug,
      p_visitor_hash: visitor.hash,
      p_request_id: requestId ?? null,
    });

    if (error || !data) {
      console.error("[api] water_experiment failed:", error?.message);
      return withCookie(TEMPORARILY_UNAVAILABLE());
    }

    switch (data.code) {
      case "watered":
      case "duplicate": {
        if (!data.state) throw new Error("water_experiment returned no state");
        return withCookie(
          json(
            {
              ok: true,
              duplicate: data.code === "duplicate",
              contributionNumber: data.contribution_number ?? null,
              experiment: toSnapshot(data.state, false, data.next_eligible_at),
            },
            data.code === "watered" ? 201 : 200,
          ),
        );
      }

      case "cooldown": {
        if (!data.state) throw new Error("water_experiment returned no state");
        const retryAfter = Math.max(1, data.retry_after_seconds ?? 1);
        return withCookie(
          errorResponse(
            429,
            "cooldown",
            "You have already watered the plant. Come back when your cooldown ends.",
            {
              nextEligibleAt: data.next_eligible_at ? new Date(data.next_eligible_at).toISOString() : null,
              retryAfterSeconds: retryAfter,
              experiment: toSnapshot(data.state, false, data.next_eligible_at),
            },
            { "Retry-After": String(retryAfter) },
          ),
        );
      }

      case "not_found":
        return withCookie(errorResponse(404, "not_found", "That experiment does not exist."));

      case "inactive":
        return withCookie(
          errorResponse(409, "experiment_inactive", "This experiment is not accepting waterings right now."),
        );

      default:
        // invalid_visitor or an unknown code means a bug on our side, not the caller's.
        throw new Error(`unexpected water_experiment code: ${data.code}`);
    }
  } catch (err) {
    return internalError(err);
  }
}

// ── GET /api/history ──────────────────────────────────────────────────────────

/**
 * Aggregate history (per-day totals and reached milestones). It contains nothing
 * about any individual visitor, so unlike the other endpoints it is safe to cache
 * briefly at the edge, which keeps database load flat however many people view it.
 */
export async function handleHistory(request: Request): Promise<Response> {
  const url = new URL(request.url); // outside try: see handleGetExperiment

  try {
    const secret = visitorSecret();
    const slug = parseSlug(url.searchParams.get("slug"), DEFAULT_EXPERIMENT_SLUG);

    const rawDays = url.searchParams.get("days");
    const days = rawDays === null ? 14 : Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new HttpError(400, "invalid_request", "days must be a whole number from 1 to 90.");
    }

    if (!readLimiter.hit(`history:${hashIp(clientIp(request), secret)}`, LIMITS.readPerMinute, 60)) {
      return errorResponse(429, "rate_limited", "Too many requests. Please slow down.", {}, {
        "Retry-After": "30",
      });
    }

    const { data, error } = await getDb().rpc<HistoryRpc>("get_experiment_history", {
      p_slug: slug,
      p_days: days,
    });

    if (error || !data) {
      console.error("[api] get_experiment_history failed:", error?.message);
      return TEMPORARILY_UNAVAILABLE();
    }
    if (!data.ok) {
      return data.code === "not_found"
        ? errorResponse(404, "not_found", "That experiment does not exist.")
        : internalError(new Error(`unexpected get_experiment_history code: ${data.code}`));
    }

    return json(toHistory(data), 200, {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    });
  } catch (err) {
    return internalError(err);
  }
}

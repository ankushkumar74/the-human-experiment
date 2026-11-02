import type { ExperimentSnapshot } from "@/lib/plant";
import type { ExperimentHistory } from "@/lib/history";
import { getVisitorHint } from "@/lib/client/visitor-hint";

/** Typed, never-throwing wrappers around our own API. */

export type ApiResult<T> =
  | { kind: "ok"; status: number; data: T }
  | { kind: "http"; status: number; code: string; body: ErrorBody }
  | { kind: "network" };

export interface ErrorBody {
  error?: { code?: string; message?: string };
  nextEligibleAt?: string | null;
  retryAfterSeconds?: number;
  experiment?: ExperimentSnapshot;
}

export interface WaterSuccess {
  ok: true;
  duplicate: boolean;
  contributionNumber: number | null;
  experiment: ExperimentSnapshot;
}

/**
 * Offset between the server clock and this device's clock, learned from the HTTP
 * Date header of uncached responses. Countdowns use it so a visitor whose device
 * clock is wrong still sees the real time until they can water again.
 */
let clockSkewMs = 0;

/** Best estimate of "now" on the server, in ms since the epoch. */
export function serverNow(): number {
  return Date.now() + clockSkewMs;
}

function learnClockSkew(res: Response): void {
  const header = res.headers.get("date");
  const server = header ? Date.parse(header) : NaN;
  // The Date header has 1-second resolution, which is plenty for a countdown.
  if (Number.isFinite(server)) clockSkewMs = server - Date.now();
}

async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const hint = getVisitorHint();
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { ...(hint ? { "x-visitor-hint": hint } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    return { kind: "network" };
  }

  if (!path.startsWith("/api/history")) learnClockSkew(res); // history may be served from a shared cache

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (res.ok) return { kind: "ok", status: res.status, data: body as T };
  const errorBody = (body ?? {}) as ErrorBody;
  return { kind: "http", status: res.status, code: errorBody.error?.code ?? "unknown", body: errorBody };
}

export const fetchExperiment = (signal?: AbortSignal) => call<ExperimentSnapshot>("/api/experiment", { signal });

export const fetchHistory = (signal?: AbortSignal) => call<ExperimentHistory>("/api/history?days=14", { signal });

export const postWater = (payload: { requestId: string; turnstileToken?: string }) =>
  call<WaterSuccess>("/api/water", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

/** What to tell the visitor when watering did not succeed. */
export interface Failure {
  message: string;
  /** Keep the same idempotency key for the next attempt (the request may have landed). */
  keepRequestId: boolean;
  /** Reset the Turnstile widget (its token is single-use). */
  resetCaptcha: boolean;
  tone: "info" | "error";
}

export function describeFailure(result: Exclude<ApiResult<unknown>, { kind: "ok" }>): Failure {
  if (result.kind === "network") {
    return {
      message: "You look offline. Your tap isn't lost. Try again when you're back.",
      keepRequestId: true,
      resetCaptcha: false,
      tone: "info",
    };
  }
  switch (result.code) {
    case "cooldown":
      return { message: "You've already watered today. The plant is still gulping.", keepRequestId: false, resetCaptcha: false, tone: "info" };
    case "rate_limited":
      return { message: "Whoa, that's a lot of taps. Give it a minute.", keepRequestId: false, resetCaptcha: false, tone: "info" };
    case "turnstile_failed":
      return { message: "The quick human check didn't pass. Please try again.", keepRequestId: false, resetCaptcha: true, tone: "error" };
    case "captcha_unavailable":
    case "temporarily_unavailable":
      return { message: "The plant is having a moment. Try again shortly.", keepRequestId: true, resetCaptcha: true, tone: "error" };
    case "experiment_inactive":
      return { message: "This experiment is paused right now.", keepRequestId: false, resetCaptcha: false, tone: "info" };
    case "forbidden_origin":
      return { message: "Open the official site to water the plant.", keepRequestId: false, resetCaptcha: false, tone: "error" };
    default:
      return { message: "Something went wrong. Please try again.", keepRequestId: result.status >= 500, resetCaptcha: true, tone: "error" };
  }
}

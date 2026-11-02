/**
 * Privacy-first analytics wrapper.
 *
 * - Completely inert unless NEXT_PUBLIC_POSTHOG_KEY is set (no script, no request).
 * - posthog-js is loaded lazily, only when the first event is sent.
 * - Autocapture, session recording and IP capture are off; identity is held in
 *   memory only, so nothing persists in the browser.
 * - Event properties are filtered so a visitor token, cookie, hash, e-mail or IP
 *   can never be sent by accident.
 */

export type AnalyticsEvent =
  | "homepage_viewed"
  | "experiment_viewed"
  | "water_button_clicked"
  | "watering_success"
  | "watering_rejected"
  | "share_clicked"
  | "share_completed"
  | "milestone_unlocked";

export type EventProps = Record<string, string | number | boolean | null | undefined>;

const FORBIDDEN_KEY = /token|visitor|cookie|hash|secret|email|\bip\b|password|participant/i;

/** Keeps only primitive values under non-sensitive keys. */
export function sanitizeProps(props: EventProps | undefined): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  if (!props) return clean;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 120);
    else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
  }
  return clean;
}

type PostHog = typeof import("posthog-js").default;
let client: Promise<PostHog> | null = null;

function load(): Promise<PostHog> | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return null;
  client ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      persistence: "memory",
    });
    return posthog;
  });
  return client;
}

export function track(event: AnalyticsEvent, props?: EventProps): void {
  const ph = load();
  if (!ph) return;
  const payload = sanitizeProps(props);
  ph.then((p) => p.capture(event, payload)).catch(() => {
    /* analytics must never break the experience */
  });
}

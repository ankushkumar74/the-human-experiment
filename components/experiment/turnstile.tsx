"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, loaded ONLY when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 * Uses the "interaction-only" appearance: visitors see nothing unless Cloudflare
 * needs to ask. Tokens are single-use, so the parent resets the widget after
 * every attempt.
 */

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("turnstile failed to load")), { once: true });
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
}

export interface TurnstileHandle {
  reset(): void;
}

export function TurnstileWidget({
  siteKey,
  onToken,
  handleRef,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  handleRef: { current: TurnstileHandle | null };
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
        handleRef.current = {
          reset: () => {
            onToken(null);
            window.turnstile?.reset(widgetId);
          },
        };
      })
      .catch(() => onToken(null));

    return () => {
      cancelled = true;
      handleRef.current = null;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, onToken, handleRef]);

  return <div ref={container} className="flex justify-center" />;
}

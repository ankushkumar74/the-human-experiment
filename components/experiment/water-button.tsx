"use client";

import { useEffect, useRef } from "react";
import { serverNow } from "@/lib/client/api";
import { formatCountdown } from "@/lib/client/format";
import { useExperiment } from "./experiment-provider";
import { useNow } from "./use-now";

function Droplet({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-5 w-5 border-[2.5px] border-ink bg-cyan ${className}`}
      style={{ borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)" }}
    />
  );
}

function Spinner() {
  return <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-[3px] border-ink/30 border-t-ink" />;
}

/** The main call to action. Every state a visitor can be in has its own face. */
export function WaterButton() {
  const { snapshot, status, watering, water, refresh } = useExperiment();
  const now = useNow(1000, serverNow);
  const refreshedFor = useRef<string | null>(null);

  const nextAt = snapshot?.nextEligibleAt ? Date.parse(snapshot.nextEligibleAt) : null;
  const remaining = nextAt !== null && now !== null ? nextAt - now : null;

  // When the cooldown ends, ask the server once whether the visitor can water again.
  useEffect(() => {
    if (!snapshot || snapshot.canWater || remaining === null || remaining > 0) return;
    if (refreshedFor.current === snapshot.nextEligibleAt) return;
    refreshedFor.current = snapshot.nextEligibleAt;
    void refresh();
  }, [snapshot, remaining, refresh]);

  if (status === "error" && !snapshot) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => void refresh()} className="btn-chunky w-full bg-white px-6 py-4 text-lg">
          Plant unreachable. Try again
        </button>
        <p className="text-center text-sm text-ink-soft">We couldn’t load the experiment. Check your connection and retry.</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <button type="button" disabled className="btn-chunky w-full px-6 py-4 text-lg sm:text-xl">
        <Spinner /> Loading the plant…
      </button>
    );
  }

  if (snapshot.canWater) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void water()}
          disabled={watering}
          aria-busy={watering}
          className="btn-chunky w-full px-6 py-4 text-xl uppercase tracking-wide sm:text-2xl"
        >
          {watering ? (
            <>
              <Spinner /> Watering…
            </>
          ) : (
            <>
              <Droplet /> Water the plant
            </>
          )}
        </button>
        <p className="text-center text-sm text-ink-soft">One watering each day, per browser. It takes one tap.</p>
      </div>
    );
  }

  const waiting = remaining !== null && remaining > 0;
  return (
    <div className="space-y-2">
      <button type="button" disabled className="btn-chunky w-full flex-col gap-0 px-6 py-3 text-lg sm:text-xl" aria-disabled="true">
        <span>You watered today ✓</span>
        <span className="font-sans text-sm font-semibold tabular-nums" aria-live="off">
          {now === null ? " " : waiting ? `Water again in ${formatCountdown(remaining)}` : "Checking the clock…"}
        </span>
      </button>
      <p className="text-center text-sm text-ink-soft">Thank you! Tell a stranger (or a friend) so the plant gets more help.</p>
    </div>
  );
}

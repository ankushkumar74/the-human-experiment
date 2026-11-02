"use client";

import { motion, useReducedMotion } from "framer-motion";
import { healthMood, type HealthMood } from "@/lib/plant";

const FILL: Record<HealthMood, string> = {
  thriving: "bg-acid",
  okay: "bg-cyan",
  thirsty: "bg-lavender",
  critical: "bg-coral",
};

const LABEL: Record<HealthMood, string> = {
  thriving: "Thriving",
  okay: "Doing okay",
  thirsty: "Getting thirsty",
  critical: "Critical!",
};

/** Chunky segmented health bar. `health` is null while the first load is in flight. */
export function HealthMeter({ health }: { health: number | null }) {
  const reduce = useReducedMotion();
  const known = health !== null;
  const mood = healthMood(health ?? 70);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-display text-sm font-bold uppercase tracking-wide">Plant health</span>
        <span className="font-display text-sm font-bold">
          {known ? (
            <>
              <span className="tabular-nums">{health}</span>
              <span className="text-ink-soft">/100 · {LABEL[mood]}</span>
            </>
          ) : (
            <span className="text-ink-soft">checking…</span>
          )}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Plant health"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? health : undefined}
        aria-valuetext={known ? `${health} out of 100, ${LABEL[mood].toLowerCase()}` : "loading"}
        className="relative h-7 overflow-hidden rounded-full border-[3px] border-ink bg-paper-deep"
      >
        {known ? (
          <motion.div
            className={`h-full ${FILL[mood]} border-r-[3px] border-ink`}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${Math.max(health, 0)}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 18 }}
            style={{ borderRightWidth: health === 0 ? 0 : 3 }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse bg-ink/10" />
        )}
        {/* segment ticks every 10 points make it feel like a game bar */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 2px), rgba(28,26,22,0.18) calc(10% - 2px), rgba(28,26,22,0.18) 10%)",
          }}
        />
      </div>
    </div>
  );
}

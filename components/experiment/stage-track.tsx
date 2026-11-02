"use client";

import { motion, useReducedMotion } from "framer-motion";
import { formatCount } from "@/lib/client/format";
import { STAGES, stageProgress } from "@/lib/plant";

/** Seven dots, one per growth stage, plus a progress bar towards the next one. */
export function StageTrack({ totalWaterings, stage }: { totalWaterings: number | null; stage: number | null }) {
  const reduce = useReducedMotion();
  const known = totalWaterings !== null && stage !== null;
  const progress = known ? stageProgress(totalWaterings) : null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-display text-sm font-bold uppercase tracking-wide">Growth stage</span>
        <span className="font-display text-sm font-bold">
          {progress ? progress.current.name : <span className="text-ink-soft">checking…</span>}
        </span>
      </div>

      <ol className="flex items-center" aria-label="Growth stages">
        {STAGES.map((s, i) => {
          const reached = known && i <= (stage as number);
          const current = known && i === stage;
          return (
            <li key={s.index} className="flex flex-1 items-center last:flex-none" aria-current={current ? "step" : undefined}>
              <span
                title={`${s.name} · ${formatCount(s.threshold)} waterings`}
                className={[
                  "relative grid h-7 w-7 shrink-0 place-items-center rounded-full border-[3px] border-ink text-[10px] font-bold",
                  reached ? (current ? "bg-lavender" : "bg-acid") : "bg-white",
                ].join(" ")}
              >
                {current && !reduce ? (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-[-7px] rounded-full border-[3px] border-lavender"
                    animate={{ scale: [1, 1.25], opacity: [0.9, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  />
                ) : null}
                <span className="sr-only">
                  {s.name}
                  {current ? " (current stage)" : reached ? " (reached)" : " (locked)"}
                </span>
                <span aria-hidden="true">{i + 1}</span>
              </span>
              {i < STAGES.length - 1 ? (
                <span aria-hidden="true" className={`h-[6px] flex-1 border-y-[2px] border-ink ${known && i < (stage as number) ? "bg-acid" : "bg-paper-deep"}`} />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 h-3 overflow-hidden rounded-full border-[2.5px] border-ink bg-paper-deep" aria-hidden="true">
        {progress ? (
          <motion.div
            className="h-full bg-lavender"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${Math.round(progress.fraction * 100)}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 18 }}
          />
        ) : null}
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        {progress
          ? progress.next
            ? `${formatCount(progress.remaining)} more ${progress.remaining === 1 ? "watering" : "waterings"} until “${progress.next.name}”`
            : "Maximum growth reached. The plant is legendary."
          : " "}
      </p>
    </div>
  );
}

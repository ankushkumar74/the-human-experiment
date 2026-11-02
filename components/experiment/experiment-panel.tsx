"use client";

import { serverNow } from "@/lib/client/api";
import { formatLocalTime, timeAgo } from "@/lib/client/format";
import { AnimatedNumber } from "./animated-number";
import { useExperiment } from "./experiment-provider";
import { HealthMeter } from "./health-meter";
import { StageTrack } from "./stage-track";
import { useNow } from "./use-now";
import { WaterButton } from "./water-button";

/** The control panel: question, live numbers and the watering button. */
export function ExperimentPanel() {
  const { snapshot, offline } = useExperiment();
  const now = useNow(15_000, serverNow);

  return (
    <section aria-labelledby="experiment-title" className="card flex flex-col gap-6 bg-white p-5 sm:p-7">
      <div>
        <p className="sticker mb-3 -rotate-2 bg-lavender text-xs uppercase tracking-wider">Experiment #01 · Save the Plant</p>
        <h2 id="experiment-title" className="text-balance font-display text-3xl font-bold leading-[1.05] sm:text-4xl">
          Can humanity save this plant?
        </h2>
      </div>

      <div className="rounded-2xl border-[3px] border-ink bg-paper px-4 py-4 sm:px-5">
        <p className="font-display text-xs font-bold uppercase tracking-wider text-ink-soft">Total waterings, worldwide</p>
        <p className="font-display text-6xl font-bold leading-none tabular-nums sm:text-7xl" aria-live="off">
          {snapshot ? <AnimatedNumber value={snapshot.totalWaterings} /> : <span className="text-ink/20">—</span>}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          {snapshot
            ? snapshot.totalWaterings === 0
              ? "Nobody has watered it yet. Be the first stranger."
              : "Each one from a real browser, each browser once a day."
            : " "}
        </p>
      </div>

      <HealthMeter health={snapshot?.health ?? null} />
      <StageTrack totalWaterings={snapshot?.totalWaterings ?? null} stage={snapshot?.growthStage ?? null} />

      {offline ? (
        <p role="status" className="rounded-xl border-[2.5px] border-ink bg-coral/30 px-3 py-2 text-sm font-medium">
          You’re offline, so these numbers may be out of date. We’ll catch up as soon as you’re back.
        </p>
      ) : null}

      <WaterButton />

      <p className="text-center text-xs text-ink-soft">
        {snapshot
          ? `Last updated ${now === null ? formatLocalTime(snapshot.updatedAt) : timeAgo(snapshot.updatedAt, now)}`
          : " "}
        {" · refreshes about every 30 seconds"}
      </p>
    </section>
  );
}

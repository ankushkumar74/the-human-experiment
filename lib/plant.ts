/**
 * Plant domain rules shared by the UI and the API.
 *
 * The database is the source of truth for state. `growth_stage_for()` in SQL
 * mirrors STAGES below; tests/db/growth.test.ts asserts both agree at every
 * boundary so the two can never silently drift apart.
 */

export interface Stage {
  /** Stage index, 0-based. Stored in experiment_state.growth_stage. */
  index: number;
  name: string;
  /** Total waterings required to reach this stage. */
  threshold: number;
}

export const STAGES: readonly Stage[] = [
  { index: 0, name: "Seed", threshold: 0 },
  { index: 1, name: "Sprout", threshold: 25 },
  { index: 2, name: "Tiny plant", threshold: 100 },
  { index: 3, name: "Growing plant", threshold: 300 },
  { index: 4, name: "Bushy plant", threshold: 750 },
  { index: 5, name: "Flowering plant", threshold: 1500 },
  { index: 6, name: "Legendary plant", threshold: 3000 },
] as const;

export const MAX_STAGE_INDEX = STAGES.length - 1;

export const HEALTH = {
  initial: 70,
  min: 0,
  max: 100,
  dailyDecay: 2,
  /** One health point is recovered for every this-many valid waterings in a UTC day. */
  wateringsPerRecoveredPoint: 10,
} as const;

/** Cooldown between waterings by the same visitor. Enforced in PostgreSQL. */
export const COOLDOWN_HOURS = 24;
export const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

/** Stage index for a given total number of waterings. */
export function stageIndexFor(totalWaterings: number): number {
  const total = Math.max(0, Math.floor(totalWaterings));
  let index = 0;
  for (const stage of STAGES) {
    if (total >= stage.threshold) index = stage.index;
  }
  return index;
}

export function stageNameFor(stageIndex: number): string {
  const clamped = Math.min(Math.max(Math.floor(stageIndex), 0), MAX_STAGE_INDEX);
  return STAGES[clamped].name;
}

export interface StageProgress {
  current: Stage;
  next: Stage | null;
  /** 0–1 progress through the current stage. 1 at the final stage. */
  fraction: number;
  /** Waterings still needed for the next stage; 0 at the final stage. */
  remaining: number;
}

export function stageProgress(totalWaterings: number): StageProgress {
  const total = Math.max(0, Math.floor(totalWaterings));
  const current = STAGES[stageIndexFor(total)];
  const next = STAGES[current.index + 1] ?? null;
  if (!next) return { current, next: null, fraction: 1, remaining: 0 };
  const span = next.threshold - current.threshold;
  return {
    current,
    next,
    fraction: Math.min(1, Math.max(0, (total - current.threshold) / span)),
    remaining: Math.max(0, next.threshold - total),
  };
}

/** Clamp a health value to the allowed range. */
export function clampHealth(value: number): number {
  return Math.min(HEALTH.max, Math.max(HEALTH.min, Math.round(value)));
}

export type HealthMood = "thriving" | "okay" | "thirsty" | "critical";

export function healthMood(health: number): HealthMood {
  if (health >= 75) return "thriving";
  if (health >= 45) return "okay";
  if (health >= 20) return "thirsty";
  return "critical";
}

/** Shape returned by GET /api/experiment and POST /api/water. */
export interface ExperimentSnapshot {
  slug: string;
  totalWaterings: number;
  health: number;
  growthStage: number;
  stageName: string;
  canWater: boolean;
  /** ISO timestamp, or null when the visitor can water right now. */
  nextEligibleAt: string | null;
  /** ISO timestamp of the last state change. */
  updatedAt: string;
}

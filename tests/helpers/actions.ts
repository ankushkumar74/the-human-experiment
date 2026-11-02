import type { Pool } from "pg";
import { fakeVisitorHash } from "./db";

export const SLUG = "save-the-plant";

export interface WaterResult {
  ok: boolean;
  code: string;
  contribution_number?: number;
  next_eligible_at?: string | null;
  retry_after_seconds?: number;
  state?: {
    slug: string;
    status: string;
    total_waterings: number;
    health: number;
    growth_stage: number;
    last_watered_at: string | null;
    updated_at: string;
  };
}

export interface StateResult extends WaterResult {
  can_water?: boolean;
}

/** Calls the real water_experiment() RPC for a visitor identified by `seed`. */
export async function water(
  pool: Pool,
  seed: string | number,
  requestId: string | null = null,
  slug = SLUG,
): Promise<WaterResult> {
  const res = await pool.query(
    "select public.water_experiment($1::text, $2::text, $3::uuid) as r",
    [slug, fakeVisitorHash(seed), requestId],
  );
  return res.rows[0].r as WaterResult;
}

export async function getState(
  pool: Pool,
  seed: string | number | null = null,
  slug = SLUG,
): Promise<StateResult> {
  const res = await pool.query("select public.get_experiment_state($1::text, $2::text) as r", [
    slug,
    seed === null ? null : fakeVisitorHash(seed),
  ]);
  return res.rows[0].r as StateResult;
}

/** `count` distinct visitors water one after another. Returns every result. */
export async function waterMany(pool: Pool, count: number, offset = 0): Promise<WaterResult[]> {
  const out: WaterResult[] = [];
  for (let i = 0; i < count; i++) out.push(await water(pool, offset + i));
  return out;
}

/** Superuser helpers for arranging time-dependent state. */
export async function setLastHealthDaysAgo(admin: Pool, days: number): Promise<void> {
  await admin.query(
    `update public.experiment_state
        set last_health_date = ((now() at time zone 'utc')::date - $1::int)`,
    [days],
  );
}

export async function setHealth(admin: Pool, health: number): Promise<void> {
  await admin.query("update public.experiment_state set health = $1", [health]);
}

/** Moves every existing watering event back in time (simulates the cooldown passing). */
export async function ageEvents(admin: Pool, hours: number): Promise<void> {
  await admin.query(
    "update public.watering_events set watered_at = watered_at - make_interval(hours => $1::int)",
    [hours],
  );
}

export async function stateRow(admin: Pool) {
  const res = await admin.query(
    `select total_waterings::int as total, health, growth_stage,
            last_health_date::text as last_health_date
       from public.experiment_state`,
  );
  return res.rows[0] as {
    total: number;
    health: number;
    growth_stage: number;
    last_health_date: string;
  };
}

export async function eventCount(admin: Pool): Promise<number> {
  const res = await admin.query("select count(*)::int as n from public.watering_events");
  return res.rows[0].n as number;
}

import { stageNameFor, type ExperimentSnapshot } from "@/lib/plant";

/** Shapes returned by the PostgreSQL RPCs (see supabase/migrations/*_functions.sql). */
export interface RpcState {
  slug: string;
  status: string;
  total_waterings: number;
  health: number;
  growth_stage: number;
  last_watered_at: string | null;
  updated_at: string;
}

export interface GetStateRpc {
  ok: boolean;
  code: string;
  can_water?: boolean;
  next_eligible_at?: string | null;
  state?: RpcState;
}

export interface WaterRpc {
  ok: boolean;
  code: string;
  contribution_number?: number;
  next_eligible_at?: string | null;
  retry_after_seconds?: number;
  state?: RpcState;
}

const iso = (value: string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

export function toSnapshot(
  state: RpcState,
  canWater: boolean,
  nextEligibleAt: string | null | undefined,
): ExperimentSnapshot {
  return {
    slug: state.slug,
    totalWaterings: Number(state.total_waterings),
    health: Number(state.health),
    growthStage: Number(state.growth_stage),
    stageName: stageNameFor(Number(state.growth_stage)),
    canWater,
    nextEligibleAt: iso(nextEligibleAt),
    updatedAt: new Date(state.updated_at).toISOString(),
  };
}

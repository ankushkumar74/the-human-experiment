/** Public shape of GET /api/history. Aggregate data only, derived from real events. */

export interface HistoryDay {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  waterings: number;
  /** Distinct visitors (browsers) who watered that day. */
  participants: number;
}

export interface HistoryMilestone {
  stage: number;
  name: string;
  threshold: number;
  /** ISO timestamp of the watering that reached this stage. */
  reachedAt: string;
}

export interface ExperimentHistory {
  slug: string;
  startedAt: string;
  totalWaterings: number;
  totalVisitors: number;
  days: HistoryDay[];
  milestones: HistoryMilestone[];
}

/** Raw shape returned by the get_experiment_history RPC. */
export interface HistoryRpc {
  ok: boolean;
  code: string;
  slug?: string;
  started_at?: string;
  total_waterings?: number;
  total_visitors?: number;
  days?: Array<{ day: string; waterings: number; participants: number }>;
  milestones?: Array<{ stage: number; name: string; threshold: number; reached_at: string }>;
}

export function toHistory(rpc: HistoryRpc): ExperimentHistory {
  return {
    slug: String(rpc.slug),
    startedAt: new Date(String(rpc.started_at)).toISOString(),
    totalWaterings: Number(rpc.total_waterings ?? 0),
    totalVisitors: Number(rpc.total_visitors ?? 0),
    days: (rpc.days ?? []).map((d) => ({
      day: d.day,
      waterings: Number(d.waterings),
      participants: Number(d.participants),
    })),
    milestones: (rpc.milestones ?? []).map((m) => ({
      stage: Number(m.stage),
      name: m.name,
      threshold: Number(m.threshold),
      reachedAt: new Date(m.reached_at).toISOString(),
    })),
  };
}

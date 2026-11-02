/** A single public contribution ("watering number N"). Contains no visitor identifiers. */
export interface Contribution {
  number: number;
  wateredAt: string;
  stage: number;
  stageName: string;
}

export interface ContributionRpc {
  ok: boolean;
  code: string;
  contribution_number?: number;
  watered_at?: string;
  stage?: number;
  stage_name?: string;
}

export function toContribution(rpc: ContributionRpc): Contribution | null {
  if (!rpc.ok) return null;
  return {
    number: Number(rpc.contribution_number),
    wateredAt: new Date(String(rpc.watered_at)).toISOString(),
    stage: Number(rpc.stage),
    stageName: String(rpc.stage_name),
  };
}

/** Parses the [n] route segment. Digits only, 1..9_999_999_999, otherwise null. */
export function parseContributionNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

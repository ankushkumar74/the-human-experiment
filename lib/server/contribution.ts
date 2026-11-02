import "server-only";
import { cacheLife } from "next/cache";
import { toContribution, type Contribution, type ContributionRpc } from "@/lib/contribution";
import { getDb } from "@/lib/db";
import { DEFAULT_EXPERIMENT_SLUG } from "@/lib/plant";

/**
 * Looks up one contribution. A contribution never changes once it exists, so a hit
 * is cached for a long time. A miss is cached only briefly because that number may
 * exist soon (the counter is still climbing).
 */
export async function getContribution(number: number): Promise<Contribution | null> {
  "use cache";
  let contribution: Contribution | null = null;
  try {
    const { data, error } = await getDb().rpc<ContributionRpc>("get_contribution", {
      p_slug: DEFAULT_EXPERIMENT_SLUG,
      p_number: number,
    });
    contribution = error || !data ? null : toContribution(data);
  } catch {
    contribution = null;
  }
  if (contribution) cacheLife("max");
  else cacheLife("seconds");
  return contribution;
}

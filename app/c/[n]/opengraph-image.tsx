import { getContribution } from "@/lib/server/contribution";
import { parseContributionNumber } from "@/lib/contribution";
import { OG_CONTENT_TYPE, OG_SIZE, renderShareCard } from "@/lib/og";

export const alt = "A contribution to The Human Experiment";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const number = parseContributionNumber(n);
  const contribution = number ? await getContribution(number) : null;

  if (!contribution) {
    return renderShareCard({
      kicker: "Experiment #01",
      headline: "Join the experiment",
      detail: "Water the shared plant.",
      stage: 2,
    });
  }

  return renderShareCard({
    kicker: `Watering #${contribution.number.toLocaleString("en-US")}`,
    headline: "I watered the plant.",
    detail: `Stage: ${contribution.stageName}`,
    stage: contribution.stage,
  });
}

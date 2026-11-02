import { OG_CONTENT_TYPE, OG_SIZE, renderShareCard } from "@/lib/og";

export const alt = "The Human Experiment: can humanity save this plant?";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderShareCard({
    kicker: "Experiment #01",
    headline: "Can humanity save this plant?",
    headlineSize: 76,
    stage: 3,
    mood: "okay",
  });
}

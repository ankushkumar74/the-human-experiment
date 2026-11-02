import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { PixelPlant } from "@/components/plant/pixel-plant";
import { ShareButtons } from "@/components/share/share-buttons";
import { parseContributionNumber } from "@/lib/contribution";
import { getContribution } from "@/lib/server/contribution";

type Props = PageProps<"/c/[n]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { n } = await params;
  const number = parseContributionNumber(n);
  const contribution = number ? await getContribution(number) : null;
  if (!contribution) return { title: "Join the experiment", robots: { index: false } };

  const title = `Watering #${contribution.number.toLocaleString("en-US")}`;
  const description = "I just watered a plant with strangers around the world. We're trying to keep it alive. Join the experiment!";
  return {
    title,
    description,
    alternates: { canonical: `/c/${contribution.number}` },
    openGraph: { title: `${title} · The Human Experiment`, description, url: `/c/${contribution.number}` },
    twitter: { card: "summary_large_image", title: `${title} · The Human Experiment`, description },
  };
}

export default function ContributionPage({ params }: Props) {
  return (
    <Suspense fallback={<PageShell title="Loading…" />}>
      <ContributionContent params={params} />
    </Suspense>
  );
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

async function ContributionContent({ params }: { params: Props["params"] }) {
  const { n } = await params;
  const number = parseContributionNumber(n);
  const contribution = number ? await getContribution(number) : null;
  if (!contribution) notFound();

  return (
    <PageShell title={`Watering #${contribution.number.toLocaleString("en-US")}`} intro="Someone, somewhere, gave the plant a drink.">
      <div className="card grid items-center gap-6 bg-gradient-to-b from-cyan/50 to-paper p-6 sm:grid-cols-[220px_1fr]">
        <PixelPlant
          stage={contribution.stage}
          health={90}
          className="pixelated mx-auto block h-auto w-48 sm:w-full"
          title={`Pixel-art ${contribution.stageName.toLowerCase()}`}
        />
        <div className="space-y-3">
          <p className="font-display text-2xl font-bold leading-tight sm:text-3xl">
            The plant was a {contribution.stageName.toLowerCase()} at this watering.
          </p>
          <p className="text-ink-soft">Watered on {DATE.format(new Date(contribution.wateredAt))} (UTC).</p>
        </div>
      </div>

      <p>
        This page shows only the watering number, the date and the plant’s stage. It doesn’t say who watered the plant.
      </p>

      <ShareButtons path={`/c/${contribution.number}`} context="contribution" />

      <p>
        <Link href="/" className="btn-chunky inline-flex px-6 py-3 text-lg no-underline">
          Water the plant yourself
        </Link>
      </p>
    </PageShell>
  );
}

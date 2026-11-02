"use client";

import Link from "next/link";
import { useExperiment } from "@/components/experiment/experiment-provider";
import { SHARE_TEXT } from "@/lib/share";
import { ShareButtons } from "./share-buttons";

/** "Spread the word". Shares the visitor's own contribution page once they have one. */
export function ShareSection() {
  const { contributionNumber } = useExperiment();
  const path = contributionNumber ? `/c/${contributionNumber}` : "/";

  return (
    <section aria-labelledby="share-title" className="card bg-lavender/30 p-5 sm:p-8">
      <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <h2 id="share-title" className="font-display text-3xl font-bold leading-tight sm:text-4xl">
            The plant needs more strangers.
          </h2>
          <blockquote className="mt-3 border-l-[5px] border-ink pl-4 text-lg font-medium">“{SHARE_TEXT}”</blockquote>
          {contributionNumber ? (
            <p className="mt-3 text-sm text-ink-soft">
              You’re sharing{" "}
              <Link href={`/c/${contributionNumber}`} className="font-semibold underline underline-offset-4">
                your watering #{contributionNumber.toLocaleString("en-US")}
              </Link>
              . The page shows only the watering number and the plant’s stage. Nothing that identifies you.
            </p>
          ) : null}
        </div>
        <ShareButtons path={path} context="home" />
      </div>
    </section>
  );
}

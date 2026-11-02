import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";
import { formatCount } from "@/lib/client/format";
import { HEALTH, STAGES } from "@/lib/plant";

export const metadata: Metadata = {
  title: "About",
  description: "What The Human Experiment is, how the shared plant grows, and how we keep the count honest.",
};

export default function AboutPage() {
  return (
    <PageShell
      title="One plant. Everybody’s job."
      intro="The Human Experiment is a small internet science project: can a crowd of strangers, who will never meet, keep one tiny plant alive?"
    >
      <h2>How it works</h2>
      <ul>
        <li>There is one shared plant. Everyone who visits sees the same plant.</li>
        <li>Each browser can water it once every 24 hours. One tap.</li>
        <li>Every watering makes the plant grow. Enough waterings unlock the next stage.</li>
        <li>
          Every UTC day the plant loses {HEALTH.dailyDecay} health points. For every {HEALTH.wateringsPerRecoveredPoint} waterings in a day it
          recovers 1 point. Health stays between {HEALTH.min} and {HEALTH.max}, and starts at {HEALTH.initial}.
        </li>
      </ul>

      <h2>The seven stages</h2>
      <ul>
        {STAGES.map((s) => (
          <li key={s.index}>
            <strong>{s.name}</strong>: {s.threshold === 0 ? "where it starts" : `${formatCount(s.threshold)} waterings`}
          </li>
        ))}
      </ul>

      <h2>Everything you see is real</h2>
      <p>
        Every number on the site comes from real waterings by real browsers. We never add fake waterings, fake visitors or invented
        activity. If the plant has a bad day, that is the experiment working. A quiet day means a quiet day.
      </p>

      <h2>What “one per person” really means</h2>
      <p>
        There are no accounts. To limit watering to once a day we recognise your <em>browser</em>, not you. That means a different browser,
        a different device, or cleared site data counts as a different visitor. We don’t try to fingerprint you to close that gap. The
        experiment runs on good faith, plus basic protection against automated spam. See <Link href="/privacy">Privacy</Link> for the details.
      </p>

      <p>
        <Link href="/" className="btn-chunky inline-flex px-6 py-3 text-lg no-underline">
          Go water the plant
        </Link>
      </p>
    </PageShell>
  );
}

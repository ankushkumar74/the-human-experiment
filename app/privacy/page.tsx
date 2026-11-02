import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What The Human Experiment stores, what it doesn’t, and how anonymous watering works.",
};

export default function PrivacyPage() {
  const analyticsOn = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
  const captchaOn = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);

  return (
    <PageShell
      title="Privacy, in plain words."
      intro="No accounts, no e-mail addresses, no ads. Here is exactly what the site keeps."
    >
      <h2>Anonymous by design</h2>
      <p>
        You never give us a name or an e-mail. To allow one watering per day, your browser gets a random anonymous ID. We store only a
        one-way scrambled version of it (a keyed hash), so the stored value can’t be turned back into your cookie, and it isn’t linked to
        your name or any account.
      </p>
      <p>
        Because the ID belongs to a <strong>browser</strong>, not to you: another browser or device counts as a new visitor, and clearing
        site data does too. That is a deliberate trade-off for keeping this anonymous.
      </p>

      <h2>What we store on our servers</h2>
      <ul>
        <li>For each watering: its number, the time, and the scrambled anonymous ID described above.</li>
        <li>
          Short-lived spam-protection counters: a scrambled form of your IP address with a request count. Your IP address itself is not
          saved, and these counters are cleared automatically.
        </li>
        <li>Totals and history are calculated from those records. Public pages show only totals and per-day counts, never anyone’s ID.</li>
      </ul>

      <h2>What lives in your browser</h2>
      <ul>
        <li>
          <code>he_visitor</code> cookie: your signed anonymous ID. Essential for the one-a-day rule. HTTP-only, kept for up to 400 days.
        </li>
        <li>
          <code>he_visitor_hint</code> (local storage): a backup copy of the anonymous ID, so clearing only cookies doesn’t reset your
          day.
        </li>
        <li>
          <code>he_last_stage</code> and <code>he_last_contribution</code> (local storage): the last stage you saw (for milestone messages)
          and your own watering number (for your share link). They never leave your device.
        </li>
      </ul>

      <h2>Analytics and checks</h2>
      <p>
        Analytics on this deployment are <strong>{analyticsOn ? "on" : "off"}</strong>.{" "}
        {analyticsOn
          ? "We count basic events (page views, button clicks, watering results, shares) with PostHog. No session recording, no autocapture, no cookies or other identifiers stored in your browser for analytics, and we never send your anonymous ID, IP address or any personal details."
          : "No analytics scripts are loaded and nothing is sent to an analytics service."}
      </p>
      <p>
        The anti-bot check (Cloudflare Turnstile) is <strong>{captchaOn ? "on" : "off"}</strong> on this deployment.
        {captchaOn ? " When on, your browser talks to Cloudflare to prove it isn’t a bot, which is governed by Cloudflare’s own privacy terms." : ""}
      </p>

      <h2>Who else touches the data</h2>
      <p>
        The site is hosted on Vercel and its database runs on Supabase. They process requests and store data on our behalf, as any host
        does. We don’t sell data and there are no ad trackers.
      </p>

      <h2>Sharing a watering</h2>
      <p>
        If you share your watering, the page at <code>/c/&lt;number&gt;</code> shows only that number, a date and the plant’s stage. It
        contains nothing that identifies you.
      </p>

      <h2>Questions or requests</h2>
      <p>
        Because records aren’t tied to your name, we usually can’t tell which watering is yours. If you have a question or concern, please
        <Link href="/contact"> contact us</Link>.
      </p>
    </PageShell>
  );
}

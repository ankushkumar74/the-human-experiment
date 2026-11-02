import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the people behind The Human Experiment.",
};

export default function ContactPage() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return (
    <PageShell title="Say hello." intro="Found a bug? Have an idea for the next experiment? We read everything.">
      {email ? (
        <p>
          Email us at <a href={`mailto:${email}`}>{email}</a>.
        </p>
      ) : (
        <p>Contact details are being set up. Please check back soon.</p>
      )}
      <p>
        For how your data is handled, see <Link href="/privacy">Privacy</Link>.
      </p>
    </PageShell>
  );
}

import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <PageShell title="That page wandered off." intro="We couldn’t find it. The plant is still where you left it.">
      <p>
        <Link href="/" className="btn-chunky inline-flex px-6 py-3 text-lg">
          Back to the plant
        </Link>
      </p>
    </PageShell>
  );
}

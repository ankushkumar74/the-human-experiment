import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-[3px] border-ink bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <p className="font-display text-2xl font-bold leading-tight text-acid sm:text-3xl">
            One planet. Millions of strangers.
            <br />
            One very thirsty plant.
          </p>
          <p className="mt-3 text-sm text-paper/70">The Human Experiment · Experiment 01 · Made for the internet, by strangers.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 font-display text-lg font-bold">
          <Link href="/about" className="underline decoration-2 underline-offset-4 hover:text-acid">About</Link>
          <Link href="/privacy" className="underline decoration-2 underline-offset-4 hover:text-acid">Privacy</Link>
          <Link href="/contact" className="underline decoration-2 underline-offset-4 hover:text-acid">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}

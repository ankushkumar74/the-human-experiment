import Link from "next/link";
import { PixelPlant } from "@/components/plant/pixel-plant";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
      <Link href="/" className="group flex items-center gap-3" aria-label="The Human Experiment, home">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border-[3px] border-ink bg-acid shadow-[3px_3px_0_0_var(--color-ink)] transition-transform group-hover:-rotate-6">
          <PixelPlant stage={2} health={90} animate={false} className="pixelated h-9 w-9" title="" />
        </span>
        <span className="font-display text-lg font-bold leading-[1.05] tracking-tight sm:text-xl">
          The Human
          <br />
          Experiment
        </span>
      </Link>
      <nav aria-label="Main" className="flex items-center gap-2 sm:gap-3">
        <Link href="/#history" className="hidden rounded-full px-3 py-2 text-sm font-semibold hover:bg-ink/5 sm:inline-block">
          History
        </Link>
        <Link href="/about" className="rounded-full px-3 py-2 text-sm font-semibold hover:bg-ink/5">
          About
        </Link>
        <span className="sticker hidden bg-cyan text-xs uppercase tracking-wider sm:inline-block">Live · Experiment 01</span>
      </nav>
    </header>
  );
}

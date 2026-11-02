import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Shared frame for the plain-text pages (About, Privacy, Contact). */
export function PageShell({ title, intro, children }: { title: string; intro?: string; children?: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4 sm:px-6">
        <h1 className="text-balance font-display text-4xl font-bold leading-[1.02] sm:text-6xl">{title}</h1>
        {intro ? <p className="mt-4 text-lg font-medium text-ink-soft sm:text-xl">{intro}</p> : null}
        <div className="mt-8 space-y-5 text-base leading-relaxed sm:text-lg [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:sm:text-3xl [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-2">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

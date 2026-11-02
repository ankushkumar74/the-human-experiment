export function HeroCopy() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-balance font-display text-[2.6rem] font-bold leading-[0.95] tracking-tight sm:text-6xl lg:text-[4rem] xl:text-7xl">
        The internet is{" "}
        <span className="relative inline-block whitespace-nowrap">
          <span aria-hidden="true" className="absolute inset-x-[-0.1em] bottom-[0.02em] top-[0.18em] -rotate-1 rounded-lg bg-acid" />
          <span className="relative">your playground.</span>
        </span>
      </h1>
      <p className="mt-4 max-w-xl text-lg font-medium text-ink-soft sm:mt-5 sm:text-xl">
        Millions of strangers. One tiny plant. Can we keep it alive?
      </p>
    </div>
  );
}

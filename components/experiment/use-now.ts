"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock for countdowns and "x minutes ago" labels.
 * Returns null until mounted, so server and first client render always match.
 */
export function useNow(intervalMs: number, now: () => number = Date.now): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setValue(now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs, now]);
  return value;
}

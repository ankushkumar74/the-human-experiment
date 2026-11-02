"use client";

import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/client/format";

/** Counts smoothly from the previous value to the new one. Screen readers get the final number only. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      from.current = value;
      const t = setTimeout(() => setShown(value), 0);
      return () => clearTimeout(t);
    }
    const controls = animate(from.current, value, {
      duration: Math.min(1.2, 0.5 + Math.abs(value - from.current) / 400),
      ease: "easeOut",
      onUpdate: (v) => {
        from.current = v;
        setShown(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span className={className}>
      <span aria-hidden="true">{formatCount(shown)}</span>
      <span className="sr-only">{formatCount(value)}</span>
    </span>
  );
}

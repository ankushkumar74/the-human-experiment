"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";

export type ToastTone = "success" | "info" | "error" | "milestone";
export interface ToastInput {
  tone: ToastTone;
  title: string;
  body?: string;
}
export interface ToastItem extends ToastInput {
  id: number;
}

const TONE: Record<ToastTone, string> = {
  success: "bg-acid",
  info: "bg-cyan",
  error: "bg-coral",
  milestone: "bg-lavender",
};

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.tone === "milestone" ? 8000 : 5500);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.95 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border-[3px] border-ink px-4 py-3 shadow-[4px_4px_0_0_var(--color-ink)] ${TONE[toast.tone]}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-bold leading-snug">{toast.title}</p>
        {toast.body ? <p className="mt-0.5 text-sm leading-snug text-ink/80">{toast.body}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss message"
        className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xl leading-none hover:bg-ink/10"
      >
        ×
      </button>
    </motion.div>
  );
}

/** Polite live region: messages are announced to screen readers without stealing focus. */
export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

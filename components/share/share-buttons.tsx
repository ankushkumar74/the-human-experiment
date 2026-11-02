"use client";

import { useRef, useState } from "react";
import { track } from "@/lib/client/analytics";
import { browserShareEnv, SHARE_TEXT, shareLink, type ShareOutcome } from "@/lib/share";

type Feedback = { tone: "ok" | "error"; text: string } | null;

const FEEDBACK: Record<ShareOutcome, Feedback> = {
  shared: { tone: "ok", text: "Thanks for spreading the word!" },
  copied: { tone: "ok", text: "Link copied. Paste it anywhere." },
  cancelled: null,
  failed: { tone: "error", text: "Couldn’t share automatically. Copy the link from the address bar instead." },
};

/**
 * Share actions. `path` is the page being shared ("/" or "/c/42"); the origin comes
 * from the browser, so the link is right on previews, custom domains and localhost.
 */
export function ShareButtons({ path, context }: { path: string; context: "home" | "contribution" }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const url = () => new URL(path, window.location.origin).toString();

  const show = (value: Feedback) => {
    setFeedback(value);
    clearTimeout(timer.current);
    if (value) timer.current = setTimeout(() => setFeedback(null), 5000);
  };

  async function onShare() {
    track("share_clicked", { channel: "share_sheet", context });
    const outcome = await shareLink({ url: url() }, browserShareEnv());
    if (outcome === "shared" || outcome === "copied") track("share_completed", { channel: outcome, context });
    show(FEEDBACK[outcome]);
  }

  async function onCopy() {
    track("share_clicked", { channel: "copy_link", context });
    const env = browserShareEnv();
    const outcome = await shareLink({ url: url() }, { writeText: env.writeText });
    if (outcome === "copied") track("share_completed", { channel: "copy_link", context });
    show(FEEDBACK[outcome]);
  }

  const external = (channel: string) => () => track("share_clicked", { channel, context });
  const text = encodeURIComponent(SHARE_TEXT);

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onShare} className="btn-chunky bg-lavender px-6 py-3 text-lg">
          Share
        </button>
        <button type="button" onClick={onCopy} className="btn-chunky bg-white px-5 py-3 text-lg">
          Copy link
        </button>
        <ExternalShare label="WhatsApp" hrefFor={() => `https://wa.me/?text=${text}%20${encodeURIComponent(url())}`} onClick={external("whatsapp")} />
        <ExternalShare label="X" hrefFor={() => `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url())}`} onClick={external("x")} />
      </div>
      <p role="status" aria-live="polite" className={`mt-3 min-h-6 text-sm font-medium ${feedback?.tone === "error" ? "text-[#b3261e]" : "text-ink"}`}>
        {feedback?.text ?? ""}
      </p>
    </div>
  );
}

/** Opens a share intent in a new window. The URL is computed on click, so it always uses the real origin. */
function ExternalShare({ label, hrefFor, onClick }: { label: string; hrefFor: () => string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Share on ${label} (opens a new window)`}
      onClick={() => {
        onClick();
        window.open(hrefFor(), "_blank", "noopener,noreferrer");
      }}
      className="btn-chunky bg-white px-5 py-3 text-lg"
    >
      {label}
    </button>
  );
}

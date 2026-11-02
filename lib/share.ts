/**
 * Sharing: the native Web Share sheet where the browser supports it, with a
 * copy-to-clipboard fallback. Pure: all browser objects are injected, so the
 * behaviour is fully testable.
 */

export const SHARE_TEXT =
  "I just watered a plant with strangers around the world. We're trying to keep it alive. Join the experiment!";
export const SHARE_TITLE = "The Human Experiment: Save the Plant";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export interface ShareEnv {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  canShare?: (data: { title?: string; text?: string; url?: string }) => boolean;
  writeText?: (text: string) => Promise<void>;
}

export async function shareLink(
  payload: { url: string; text?: string; title?: string },
  env: ShareEnv,
): Promise<ShareOutcome> {
  const data = { title: payload.title ?? SHARE_TITLE, text: payload.text ?? SHARE_TEXT, url: payload.url };

  if (env.share && (env.canShare ? env.canShare(data) : true)) {
    try {
      await env.share(data);
      return "shared";
    } catch (err) {
      // Closing the share sheet is a choice, not an error: do not fall back.
      if ((err as { name?: string })?.name === "AbortError") return "cancelled";
      // Any other failure: try the clipboard instead.
    }
  }

  if (env.writeText) {
    try {
      await env.writeText(payload.url);
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "failed";
}

/** The browser's real share/clipboard capabilities, with a legacy copy fallback. */
export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    share: nav?.share ? (d) => nav.share(d) : undefined,
    canShare: nav?.canShare ? (d) => nav.canShare(d) : undefined,
    writeText: async (text) => {
      if (nav?.clipboard?.writeText) return nav.clipboard.writeText(text);
      legacyCopy(text);
    },
  };
}

function legacyCopy(text: string): void {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) throw new Error("copy failed");
}

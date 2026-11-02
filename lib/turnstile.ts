import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid" | "unavailable" };

/**
 * Verifies a Cloudflare Turnstile token server-side. Fails closed: if the
 * token is absent or rejected, or Cloudflare cannot be reached, the watering is
 * not allowed (an unreachable verifier is reported separately so the UI can
 * say "try again" instead of "you look like a bot").
 */
export async function verifyTurnstile(
  token: unknown,
  secret: string,
  remoteIp?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: "missing" };
  }

  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);

  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const outcome = (await res.json()) as { success?: boolean };
    return outcome.success === true ? { ok: true } : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

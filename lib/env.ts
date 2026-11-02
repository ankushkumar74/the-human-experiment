import "server-only";

/**
 * Server-side environment access. Values are read lazily so that importing a
 * module never crashes a build that does not need Supabase (for example the
 * static pages), and so tests can set variables per test.
 */

export class MissingEnvError extends Error {
  constructor(public readonly variable: string) {
    super(
      `Missing required environment variable ${variable}. ` +
        `Copy .env.example to .env.local and fill it in (see README).`,
    );
    this.name = "MissingEnvError";
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") throw new MissingEnvError(name);
  return value.trim();
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function visitorSecret(): string {
  const secret = requireEnv("VISITOR_COOKIE_SECRET");
  if (secret.length < 32) {
    throw new Error(
      "VISITOR_COOKIE_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48",
    );
  }
  return secret;
}

/** Turnstile is enabled only when both the site key and the secret are set. */
export function turnstileConfig(): { secret: string } | null {
  const secret = optionalEnv("TURNSTILE_SECRET_KEY");
  const siteKey = optionalEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  return secret && siteKey ? { secret } : null;
}

/** Canonical public URL, with sensible fallbacks for Vercel preview deployments. */
export function siteUrl(): string {
  const explicit = optionalEnv("NEXT_PUBLIC_SITE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelProd = optionalEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (vercelProd) return `https://${vercelProd}`;
  const vercel = optionalEnv("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const isProduction = () => process.env.NODE_ENV === "production";

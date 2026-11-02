import { createClient } from "@supabase/supabase-js";

/**
 * Anonymous (public) Supabase client. It carries only the anon key, which Row
 * Level Security restricts to the aggregate read-only views
 * (public_experiment_state, experiment_daily_history, experiment_milestones).
 * It cannot read the base tables and cannot write anything.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

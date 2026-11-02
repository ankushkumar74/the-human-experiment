#!/usr/bin/env node
/**
 * Smoke test for a running deployment (local, Vercel preview or production).
 *
 *   npm run verify -- https://your-app.vercel.app
 *   npm run verify -- http://localhost:3000 --no-water
 *
 * What it checks
 *   1. GET /api/experiment and /api/history return well-formed JSON, not cached.
 *   2. Cross-site POSTs to /api/water are refused.
 *   3. (unless --no-water) A first watering succeeds, sets a hardened cookie, and an
 *      immediate second watering from the same visitor is refused with a cooldown.
 *      NOTE: this adds ONE real watering to the experiment. Use --no-water to skip.
 *   4. (optional) Database lock-down: with NEXT_PUBLIC_SUPABASE_URL and
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment, proves the public anon key
 *      cannot read tables, call game functions or write anything.
 *
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:3000").replace(/\/$/, "");
const skipWater = args.includes("--no-water");
const origin = new URL(base).origin;

let failed = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail = "") => {
  failed++;
  console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
};
const check = (cond, name, detail) => (cond ? ok(name) : bad(name, detail));

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

console.log(`Verifying ${base}\n`);

// 1. Read endpoints ---------------------------------------------------------
console.log("Read endpoints");
let state = null;
try {
  const res = await fetch(`${base}/api/experiment`);
  state = await json(res);
  check(res.status === 200, "GET /api/experiment returns 200", `got ${res.status} ${JSON.stringify(state)}`);
  if (state) {
    check(
      typeof state.totalWaterings === "number" &&
        Number.isInteger(state.health) && state.health >= 0 && state.health <= 100 &&
        Number.isInteger(state.growthStage) && typeof state.stageName === "string" &&
        typeof state.canWater === "boolean",
      "state has the expected fields and valid ranges",
      JSON.stringify(state),
    );
  }
  check(/no-store/.test(res.headers.get("cache-control") ?? ""), "state response is not cached", res.headers.get("cache-control") ?? "no header");
} catch (err) {
  bad("GET /api/experiment reachable", err.message);
}

try {
  const res = await fetch(`${base}/api/history?days=14`);
  const body = await json(res);
  check(res.status === 200 && Array.isArray(body?.days) && Array.isArray(body?.milestones), "GET /api/history returns days and milestones", `got ${res.status}`);
} catch (err) {
  bad("GET /api/history reachable", err.message);
}

// 2. Cross-site protection ---------------------------------------------------
console.log("\nAbuse protection");
try {
  const res = await fetch(`${base}/api/water`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: "{}",
  });
  check(res.status === 403, "cross-site POST /api/water is refused (403)", `got ${res.status}`);
} catch (err) {
  bad("cross-site POST test", err.message);
}
try {
  const res = await fetch(`${base}/api/water`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin },
    body: "{}",
  });
  check(res.status === 415, "non-JSON POST is refused (415)", `got ${res.status}`);
} catch (err) {
  bad("content-type test", err.message);
}

// 3. Watering + cooldown -----------------------------------------------------
if (skipWater) {
  console.log("\nWatering (skipped: --no-water)");
} else {
  console.log("\nWatering (adds ONE real watering)");
  try {
    const requestId = crypto.randomUUID();
    const first = await fetch(`${base}/api/water`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ requestId }),
    });
    const firstBody = await json(first);
    if (first.status === 403 && firstBody?.error?.code === "turnstile_failed") {
      console.log("  - Turnstile is enabled, so a script cannot water. Skipping (this is expected).");
    } else if (first.status === 429 && firstBody?.error?.code === "rate_limited") {
      console.log("  - Rate limited (too many recent tests from this IP). Wait a minute and retry.");
    } else {
      check(first.status === 201 && firstBody?.ok === true, "first watering succeeds (201)", `got ${first.status} ${JSON.stringify(firstBody)}`);
      check(Number.isInteger(firstBody?.contributionNumber), "response includes a contribution number");
      const setCookie = first.headers.get("set-cookie") ?? "";
      check(/he_visitor=/.test(setCookie), "visitor cookie is issued");
      check(/HttpOnly/i.test(setCookie), "cookie is HttpOnly");
      check(/SameSite=Lax/i.test(setCookie), "cookie is SameSite=Lax");
      if (origin.startsWith("https://")) check(/;\s*Secure/i.test(setCookie), "cookie is Secure on https");
      check(!/\bhash\b|visitor_hash|participant/i.test(JSON.stringify(firstBody)), "response leaks no visitor identifiers");

      const cookie = setCookie.split(";")[0];
      const second = await fetch(`${base}/api/water`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      const secondBody = await json(second);
      check(second.status === 429 && secondBody?.error?.code === "cooldown", "second watering is refused with a cooldown (429)", `got ${second.status} ${JSON.stringify(secondBody)}`);
      check(Boolean(second.headers.get("retry-after")), "cooldown response has Retry-After");

      const retry = await fetch(`${base}/api/water`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie },
        body: JSON.stringify({ requestId }),
      });
      const retryBody = await json(retry);
      check(retry.status === 200 && retryBody?.duplicate === true, "retrying the SAME request id is idempotent (200, duplicate)", `got ${retry.status}`);
    }
  } catch (err) {
    bad("watering flow", err.message);
  }
}

// 4. Database lock-down -------------------------------------------------------
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supaUrl || !anon) {
  console.log("\nDatabase lock-down (skipped: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to run)");
} else {
  console.log("\nDatabase lock-down (using the PUBLIC anon key, as any visitor could)");
  const h = { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" };
  const rest = (p, init = {}) => fetch(`${supaUrl}/rest/v1/${p}`, { ...init, headers: { ...h, ...(init.headers ?? {}) } });

  for (const table of ["participants", "watering_events", "experiment_state", "rate_limits", "experiments"]) {
    const res = await rest(`${table}?select=*&limit=1`);
    const body = await json(res);
    const leaked = res.status === 200 && Array.isArray(body) && body.length > 0;
    check(!leaked, `anon cannot read table "${table}"`, `status ${res.status}, rows ${Array.isArray(body) ? body.length : "n/a"}`);
  }
  for (const [fn, payload] of [
    ["water_experiment", { p_slug: "save-the-plant", p_visitor_hash: "a".repeat(64), p_request_id: null }],
    ["get_experiment_state", { p_slug: "save-the-plant", p_visitor_hash: null }],
    ["hit_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 60 }],
    ["get_contribution", { p_slug: "save-the-plant", p_number: 1 }],
  ]) {
    const res = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(payload) });
    check([401, 403, 404].includes(res.status), `anon cannot call ${fn}()`, `status ${res.status}`);
  }
  const view = await rest("public_experiment_state?select=*");
  const viewBody = await json(view);
  check(view.status === 200 && Array.isArray(viewBody), "anon can read the public aggregate view", `status ${view.status}`);
  if (Array.isArray(viewBody) && viewBody[0]) {
    check(!("visitor_hash" in viewBody[0]) && !("participant_id" in viewBody[0]), "public view exposes no visitor identifiers");
  }
  const write = await rest("public_experiment_state", { method: "PATCH", body: JSON.stringify({ total_waterings: 999999 }) });
  check(write.status >= 400, "anon cannot write through the public view", `status ${write.status}`);
  const insert = await rest("watering_events", { method: "POST", body: JSON.stringify({}) });
  check(insert.status >= 400, "anon cannot insert watering events", `status ${insert.status}`);
}

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);

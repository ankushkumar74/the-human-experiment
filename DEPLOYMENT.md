# Deployment guide

Goal: a working temporary URL on `*.vercel.app` that 5–10 people can test. No domain, no paid services.

Time needed: about 20 minutes. Cost: free tiers only.

## What you need

- A GitHub account with this repository (done)
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account (sign in with GitHub)

## Step 1: Create the database (Supabase)

1. Supabase dashboard → **New project**. Pick a name and a strong database password (save it in a password manager; the app doesn't use it).
2. Pick the region **closest to most of your testers**. You'll match Vercel's region to it in Step 3.
3. Wait for the project to finish provisioning (1–2 minutes).
4. Open **SQL Editor → New query**.
5. Open `supabase/setup.sql` from this repo, copy **all** of it, paste it into the editor and click **Run**.
   - It must say "Success. No rows returned".
   - Run it **once**, on an empty project. Running it twice fails on purpose (tables already exist).
6. Check **Table Editor**: you should see `experiments`, `experiment_state`, `participants`, `watering_events`, `growth_stages`, `rate_limits`. The `experiments` table has one row, `save-the-plant`.
7. Check **Authentication → Policies** (or Table Editor → each table): RLS must show as **enabled** on all six tables. It is, by the migration.

### Collect your keys

Supabase → **Project Settings → API**. You need three values:

| Value | Where it goes | Secret? |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | No |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No (safe in the browser; can only read 3 aggregate views) |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` | **YES. Never share, commit, screenshot or paste into chat.** |

Newer Supabase projects may label these "publishable" and "secret" keys. Use the publishable key as the anon key and the secret key as the service-role key.

## Step 2: Make a visitor secret

In a terminal:

```bash
openssl rand -base64 48
```

Copy the output. This is `VISITOR_COOKIE_SECRET`. Keep it private.

- Changing it later resets every visitor's identity, so everyone could water once more. Don't rotate it casually.

## Step 3: Deploy on Vercel

1. Vercel → **Add New… → Project** → import `the-human-experiment` from GitHub.
2. Framework preset: **Next.js** (auto-detected). Leave build settings as they are.
3. Open **Environment Variables** and add (for Production **and** Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Step 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Step 1 |
   | `VISITOR_COOKIE_SECRET` | from Step 2 |
   | `NEXT_PUBLIC_CONTACT_EMAIL` | an address you're happy to publish (shown on the Contact page) |

   Leave `LOCAL_DATABASE_URL` unset. Leave `NEXT_PUBLIC_SITE_URL` unset for now (the app falls back to Vercel's URL).
4. Click **Deploy**.
5. Recommended: **Project Settings → Functions → Function Region**, choose the region nearest your Supabase region. This keeps watering fast.

## Step 4: Verify the deployment

From your machine (needs Node 20+ and `npm install` once):

```bash
# Safe: read-only checks
npm run verify -- https://YOUR-APP.vercel.app --no-water

# Full: also performs ONE real watering to test the cooldown
npm run verify -- https://YOUR-APP.vercel.app

# Also prove the public key can't touch private data (recommended once)
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  npm run verify -- https://YOUR-APP.vercel.app --no-water
```

Every line should show a ✓. Then open the URL on your phone and water the plant.

If `/api/experiment` returns `{"error":{"code":"server_error",...}}`, one of the environment variables is missing or wrong. Check **Vercel → Deployments → (latest) → Logs**, where the message names the missing variable. Fix it, then **Redeploy** (changed variables only apply to new deployments).

## Step 5 (optional): Bot check with Cloudflare Turnstile (free)

Recommended before sharing widely. Skip it for a small friends test.

1. Cloudflare dashboard → **Turnstile → Add widget**. Add your Vercel hostname. Mode: **Managed**.
2. Add two Vercel environment variables, then redeploy:
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`
3. It turns on only when **both** are set. If Cloudflare is unreachable, watering is refused (fails closed) rather than silently skipping the check.
4. With Turnstile on, `npm run verify` can't water (scripts can't pass the check). That's expected.

## Step 6 (optional): Analytics with PostHog (free tier)

1. Create a PostHog project and copy its **project API key**.
2. Add `NEXT_PUBLIC_POSTHOG_KEY` (and `NEXT_PUBLIC_POSTHOG_HOST` if you use the EU cloud: `https://eu.i.posthog.com`). Redeploy.
3. The Privacy page updates itself to say analytics are on. Read [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) for the consent question first.

## Step 7: After testing, a custom domain

Don't buy one yet. When ready: Vercel → **Settings → Domains**, then set `NEXT_PUBLIC_SITE_URL` to the final `https://…` address and redeploy. This makes share links, social previews and the sitemap use the real domain.

## Updating the database later

- Add a **new** file in `supabase/migrations/` with a later timestamp, run `npm run db:bundle`, and run only the new file's SQL in the Supabase SQL editor.
- Never edit an applied migration.

## Rollback

- App: Vercel → **Deployments** → pick an earlier deployment → **Promote to Production**.
- Reset the experiment counters (for example after testing, before the real launch): see "Reset before launch" in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Page loads but says "Plant unreachable" | Missing or wrong env var, or Supabase project paused. Check Vercel logs. |
| Everyone can water repeatedly | `VISITOR_COOKIE_SECRET` changed between deploys, or testers are using different browsers/devices (expected). |
| `permission denied` in Vercel logs | `SUPABASE_SERVICE_ROLE_KEY` is actually the anon key. |
| Share previews show no image | Social sites cache previews. Re-scrape with the platform's debugger tool. |
| Works locally, not on Vercel | `LOCAL_DATABASE_URL` is ignored on Vercel by design. Set the Supabase variables. |

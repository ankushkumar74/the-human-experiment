# Launch checklist

Use top to bottom. Nothing here costs money. Do not buy a domain until Phase C is done.

## Phase A: Before anyone else sees it

- [ ] Supabase: `supabase/setup.sql` ran without errors; 6 tables exist; RLS shows **enabled** on all of them
- [ ] Vercel env vars set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VISITOR_COOKIE_SECRET`, `NEXT_PUBLIC_CONTACT_EMAIL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is the **secret** key (not the anon key) and is not visible in any browser request (DevTools → Network)
- [ ] `VISITOR_COOKIE_SECRET` generated with `openssl rand -base64 48`, stored in a password manager
- [ ] `npm run verify -- <url>` passes, including the database lock-down section (provide the two `NEXT_PUBLIC_SUPABASE_*` variables)
- [ ] Open the site on your own phone: water the plant, reload, see the countdown, turn on airplane mode and see the offline message
- [ ] Contact page shows a working address
- [ ] About and Privacy pages read correctly. The Privacy page describes what the app does today. **Have it reviewed against the laws that apply to your visitors before a public launch.** This project makes no compliance claims.

## Phase B: Friends test (5–10 people)

Send the Vercel URL. Ask each person to use their phone and, if possible, a different network.

- [ ] Everyone gets a working page within ~3 seconds
- [ ] Each person can water once, then sees the countdown
- [ ] The count on everyone's screen rises within ~30 seconds of someone else watering (no manual reload)
- [ ] Share works on iOS Safari and Android Chrome (native sheet) and on desktop (link copied)
- [ ] A shared `/c/<number>` link shows a preview card in WhatsApp / iMessage / Slack
- [ ] Nobody reports confusion about what to do. Watch where they hesitate. Ask: "What do you think happens when you tap?" and "Would you share this? Why or why not?"
- [ ] Note any device or browser with visual problems (screenshots please)
- [ ] Check Vercel logs and Supabase logs for errors during the test

Metrics worth noting (PostHog, if enabled): visits → `water_button_clicked` → `watering_success`; `share_clicked` per success; `watering_rejected` reasons.

## Phase C: Before buying a domain / going public

- [ ] Fixes from Phase B done
- [ ] Decide on Turnstile (recommended before wide sharing; see DEPLOYMENT.md Step 5)
- [ ] Decide on analytics. If you turn PostHog on, check the consent rules for your audience and keep the Privacy page accurate
- [ ] Supabase plan: the free tier pauses after about a week of inactivity and has usage limits. Decide whether to upgrade before a big launch (this is a paid decision. Don't do it without deciding deliberately)
- [ ] Backups: Supabase free tier has no point-in-time backups. Export `watering_events` if the history matters to you
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the final domain and redeploy
- [ ] Re-test social preview cards with the final domain (platform debugger tools cache old previews)
- [ ] Confirm `/robots.txt` and `/sitemap.xml` use the final domain

### Reset before launch

Test waterings are real rows. To start the public experiment from zero, in the Supabase SQL editor:

```sql
-- DESTROYS ALL WATERING DATA. Only do this before the real launch.
truncate public.watering_events, public.participants, public.rate_limits;
update public.experiment_state
   set total_waterings = 0, health = 70, growth_stage = 0,
       last_health_date = (now() at time zone 'utc')::date,
       last_watered_at = null, updated_at = now();
```

Testers' browsers will still hold their cookie, but the server no longer knows them, so they can water again.

## Launch day

- [ ] Post at a moment you can watch the first hour
- [ ] Watch: Vercel logs, Supabase **Reports** (API requests, database health), PostHog events
- [ ] Be ready to roll back: Vercel → Deployments → Promote an earlier deployment
- [ ] Keep `SUPABASE_SERVICE_ROLE_KEY` and `VISITOR_COOKIE_SECRET` out of screenshots and chats

## If something goes wrong

| Problem | Action |
|---|---|
| Bots / scripted abuse | Turn on Turnstile (Vercel env vars + redeploy) |
| Traffic spike | Reads are cheap and polling is jittered. If Supabase limits hit, upgrade the plan |
| A leaked secret | Rotate in Supabase (service role key) and Vercel, then redeploy. For `VISITOR_COOKIE_SECRET`, rotating resets everyone's cooldown |
| Wrong data from a bug | Fix, deploy. State is derived from `watering_events`, so totals can be rebuilt from it if needed |

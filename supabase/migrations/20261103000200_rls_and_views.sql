-- ============================================================================
-- Row Level Security and safe public read access
--
-- Policy: RLS is ENABLED on every table and NO policy is created for anon or
-- authenticated. With RLS on and no policy, those roles can neither read nor
-- write the base tables. The service role (used only by our server-side API)
-- bypasses RLS. Visitors therefore cannot update shared state or insert
-- watering events directly, whatever they send to the Supabase REST API.
--
-- The only public read access is through three aggregate views below. They run
-- with their owner's rights (security_invoker = false) and expose no visitor
-- hashes, participant ids or request ids.
-- ============================================================================

alter table public.experiments      enable row level security;
alter table public.growth_stages    enable row level security;
alter table public.experiment_state enable row level security;
alter table public.participants     enable row level security;
alter table public.watering_events  enable row level security;
alter table public.rate_limits      enable row level security;

-- Belt and braces: remove table privileges too, so access is denied even if a
-- permissive policy is ever added by mistake.
revoke all on public.experiments      from anon, authenticated;
revoke all on public.growth_stages    from anon, authenticated;
revoke all on public.experiment_state from anon, authenticated;
revoke all on public.participants     from anon, authenticated;
revoke all on public.watering_events  from anon, authenticated;
revoke all on public.rate_limits      from anon, authenticated;

-- ── Public aggregate views ──────────────────────────────────────────────────

-- Current plant state. Health is the *effective* value: any UTC days whose
-- decay has not yet been persisted are applied on the fly (read-only).
create view public.public_experiment_state
with (security_invoker = false) as
select
  e.slug,
  e.title,
  e.status,
  s.total_waterings,
  greatest(
    0,
    s.health - 2 * greatest(0, ((now() at time zone 'utc')::date - s.last_health_date))
  )                       as health,
  s.growth_stage,
  g.name                  as stage_name,
  s.last_watered_at,
  s.updated_at
from public.experiments e
join public.experiment_state s on s.experiment_id = e.id
join public.growth_stages g on g.stage = s.growth_stage;

-- Per-day totals, derived from real watering events.
create view public.experiment_daily_history
with (security_invoker = false) as
select
  e.slug,
  w.watered_on                              as day,
  count(*)::integer                         as waterings,
  count(distinct w.participant_id)::integer as participants
from public.watering_events w
join public.experiments e on e.id = w.experiment_id
group by e.slug, w.watered_on;

-- When each growth stage was actually reached: the timestamp of the watering
-- whose sequence number equals the stage threshold.
create view public.experiment_milestones
with (security_invoker = false) as
select
  e.slug,
  g.stage,
  g.name,
  g.threshold,
  w.watered_at as reached_at
from public.experiments e
cross join public.growth_stages g
join public.watering_events w
  on w.experiment_id = e.id
 and w.sequence_number = g.threshold
where g.threshold > 0;

-- Supabase's default privileges grant ALL on new public objects to anon and
-- authenticated. Strip those first so the views are provably read-only (rather
-- than merely non-updatable today), then grant SELECT and nothing else.
revoke all on public.public_experiment_state from anon, authenticated;
revoke all on public.experiment_daily_history from anon, authenticated;
revoke all on public.experiment_milestones   from anon, authenticated;

grant select on public.public_experiment_state to anon, authenticated;
grant select on public.experiment_daily_history to anon, authenticated;
grant select on public.experiment_milestones   to anon, authenticated;

-- The identity sequence behind watering_events.id is not for visitors either.
revoke all on all sequences in schema public from anon, authenticated;

-- ============================================================================
-- The Human Experiment: complete database setup (GENERATED FILE, do not edit).
-- Source of truth: supabase/migrations/*.sql. Regenerate with `npm run db:bundle`.
--
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Run it ONCE on an empty project. It is not safe to run twice.
-- Contains 5 migrations: 20261103000100_core_schema.sql, 20261103000200_rls_and_views.sql, 20261103000300_functions.sql, 20261103000400_seed.sql, 20261103000500_history_and_contributions.sql
-- ============================================================================

-- ---------- 20261103000100_core_schema.sql ----------
-- ============================================================================
-- The Human Experiment — core schema
--
-- Design notes
--   * experiment_state holds the ONE shared, mutable record per experiment. Every
--     watering locks that row (SELECT ... FOR UPDATE), so concurrent requests are
--     serialised and neither cooldowns nor counters can be bypassed or lost.
--   * watering_events is the append-only source of truth. Statistics such as
--     per-day counts, history and milestones are derived from it, never invented.
--   * Visitors are stored only as an HMAC hash (participants.visitor_hash). The raw
--     browser identifier is never persisted.
--   * All "days" are UTC calendar days.
-- ============================================================================

create table public.experiments (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title       text not null,
  description text not null default '',
  status      text not null default 'active'
                check (status in ('active', 'paused', 'archived')),
  created_at  timestamptz not null default now()
);

-- Reference data: growth stages. Single SQL source of truth for thresholds.
-- (lib/plant.ts mirrors it; tests/db/growth.test.ts asserts they agree.)
create table public.growth_stages (
  stage     smallint primary key check (stage >= 0),
  name      text not null,
  threshold bigint not null unique check (threshold >= 0)
);

create table public.experiment_state (
  experiment_id    uuid primary key
                     references public.experiments (id) on delete cascade,
  total_waterings  bigint   not null default 0 check (total_waterings >= 0),
  health           integer  not null default 70 check (health between 0 and 100),
  growth_stage     smallint not null default 0 check (growth_stage >= 0),
  -- UTC date whose daily decay has already been applied. Guarantees the decay
  -- for any given day is calculated exactly once.
  last_health_date date     not null default ((now() at time zone 'utc')::date),
  last_watered_at  timestamptz,
  updated_at       timestamptz not null default now()
);

create table public.participants (
  id            uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  -- HMAC-SHA256 (hex) of the visitor's identifier. Never the raw identifier.
  visitor_hash  text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  constraint participants_experiment_visitor_key unique (experiment_id, visitor_hash)
);

create table public.watering_events (
  id              bigint generated always as identity primary key,
  experiment_id   uuid   not null references public.experiments (id) on delete cascade,
  participant_id  uuid   not null references public.participants (id) on delete cascade,
  -- Equals experiment_state.total_waterings right after this watering. The
  -- unique constraint below makes a lost counter update impossible to persist.
  sequence_number bigint not null check (sequence_number > 0),
  -- Optional client-generated idempotency key so a retried request is not
  -- recorded twice.
  request_id      uuid,
  watered_at      timestamptz not null default clock_timestamp(),
  -- UTC calendar day, derived so it can never disagree with watered_at.
  watered_on      date generated always as ((watered_at at time zone 'utc')::date) stored,
  constraint watering_events_experiment_sequence_key unique (experiment_id, sequence_number)
);

-- Cooldown lookup: "latest watering for this participant".
create index watering_events_participant_recent_idx
  on public.watering_events (participant_id, watered_at desc);

-- Per-day statistics and daily health recovery.
create index watering_events_experiment_day_idx
  on public.watering_events (experiment_id, watered_on);

-- Duplicate-submission guard.
create unique index watering_events_participant_request_key
  on public.watering_events (participant_id, request_id)
  where request_id is not null;

-- Fixed-window request counters used for rate limiting. Keys are hashed by the
-- application, so no raw IP address is stored.
create table public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  primary key (key, window_start)
);

create index rate_limits_window_idx on public.rate_limits (window_start);

-- ---------- 20261103000200_rls_and_views.sql ----------
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

-- ---------- 20261103000300_functions.sql ----------
-- ============================================================================
-- Atomic watering logic
--
-- All functions are SECURITY DEFINER with an empty search_path (every object is
-- schema-qualified) and are executable ONLY by the service role. The Next.js
-- server calls them; browsers never can.
-- ============================================================================

-- Growth stage for a total number of waterings, from the growth_stages table.
create function public.growth_stage_for(p_total bigint)
returns smallint
language sql
stable
set search_path = ''
as $$
  select coalesce(max(g.stage), 0)::smallint
  from public.growth_stages g
  where g.threshold <= greatest(p_total, 0)
$$;

-- Applies the daily decay for every UTC day that has started since the last
-- processed one. The CALLER MUST ALREADY HOLD THE experiment_state ROW LOCK.
--
-- last_health_date is the day whose decay is already applied. Moving it forward
-- is what guarantees each day's decay is calculated exactly once, however many
-- requests (or days of silence) occur in between.
create function public._advance_health(p_experiment_id uuid, p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  c_daily_decay constant integer := 2;
  v_today date := (p_now at time zone 'utc')::date;
  v_last  date;
  v_days  integer;
begin
  select s.last_health_date into v_last
  from public.experiment_state s
  where s.experiment_id = p_experiment_id;

  if v_last is null or v_last >= v_today then
    return;
  end if;

  v_days := v_today - v_last;

  update public.experiment_state
     set health           = greatest(0, health - c_daily_decay * v_days),
         last_health_date = v_today,
         updated_at       = p_now
   where experiment_id = p_experiment_id;
end;
$$;

create function public._state_json(
  p_slug   text,
  p_status text,
  p_state  public.experiment_state
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'slug',            p_slug,
    'status',          p_status,
    'total_waterings', p_state.total_waterings,
    'health',          p_state.health,
    'growth_stage',    p_state.growth_stage,
    'last_watered_at', p_state.last_watered_at,
    'updated_at',      p_state.updated_at
  )
$$;

-- ── water_experiment ────────────────────────────────────────────────────────
-- Result codes (always a jsonb object with "ok" and "code"):
--   watered        ok=true   a new valid watering was recorded
--   duplicate      ok=true   this request_id was already recorded; nothing added
--   cooldown       ok=false  visitor watered less than 24h ago
--   invalid_visitor / not_found / inactive   ok=false
create function public.water_experiment(
  p_slug         text,
  p_visitor_hash text,
  p_request_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cooldown            constant interval := interval '24 hours';
  c_waterings_per_point constant integer  := 10;
  v_exp           public.experiments%rowtype;
  v_state         public.experiment_state%rowtype;
  v_now           timestamptz;
  v_today         date;
  v_participant   uuid;
  v_last          timestamptz;
  v_dup_seq       bigint;
  v_dup_at        timestamptz;
  v_seq           bigint;
  v_today_count   integer;
  v_health        integer;
begin
  if p_visitor_hash is null or p_visitor_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_visitor');
  end if;

  select * into v_exp from public.experiments where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_exp.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'inactive');
  end if;

  -- 1. Lock the shared state row. Every watering of this experiment queues here,
  --    so everything below runs strictly one request at a time.
  perform 1 from public.experiment_state where experiment_id = v_exp.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Server-side time, read only AFTER the lock is held so timestamps follow the
  -- same order as the sequence numbers.
  v_now   := clock_timestamp();
  v_today := (v_now at time zone 'utc')::date;

  -- 2. Process any pending daily health updates.
  perform public._advance_health(v_exp.id, v_now);
  select * into v_state from public.experiment_state where experiment_id = v_exp.id;

  -- 3. The visitor's previous valid watering.
  select p.id into v_participant
  from public.participants p
  where p.experiment_id = v_exp.id and p.visitor_hash = p_visitor_hash;

  if v_participant is not null then
    -- Duplicate submission of the very same request: report it, add nothing.
    if p_request_id is not null then
      select w.sequence_number, w.watered_at into v_dup_seq, v_dup_at
      from public.watering_events w
      where w.participant_id = v_participant and w.request_id = p_request_id;

      if found then
        return jsonb_build_object(
          'ok', true,
          'code', 'duplicate',
          'contribution_number', v_dup_seq,
          'next_eligible_at', v_dup_at + c_cooldown,
          'state', public._state_json(v_exp.slug, v_exp.status, v_state)
        );
      end if;
    end if;

    select max(w.watered_at) into v_last
    from public.watering_events w
    where w.participant_id = v_participant;
  end if;

  -- 4. Reject anything inside the rolling 24-hour cooldown.
  if v_last is not null and v_now < v_last + c_cooldown then
    return jsonb_build_object(
      'ok', false,
      'code', 'cooldown',
      'next_eligible_at', v_last + c_cooldown,
      'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (v_last + c_cooldown - v_now)))::integer),
      'state', public._state_json(v_exp.slug, v_exp.status, v_state)
    );
  end if;

  -- 5. Record the watering.
  if v_participant is null then
    insert into public.participants (experiment_id, visitor_hash)
    values (v_exp.id, p_visitor_hash)
    returning id into v_participant;
  end if;

  v_seq := v_state.total_waterings + 1;

  insert into public.watering_events
    (experiment_id, participant_id, sequence_number, request_id, watered_at)
  values
    (v_exp.id, v_participant, v_seq, p_request_id, v_now);

  -- 6. Update totals, growth stage and health. Recovery is +1 health for each
  --    10 valid waterings in the UTC day, counted from the real events.
  select count(*)::integer into v_today_count
  from public.watering_events w
  where w.experiment_id = v_exp.id and w.watered_on = v_today;

  v_health := v_state.health;
  if v_today_count % c_waterings_per_point = 0 then
    v_health := least(100, v_health + 1);
  end if;

  update public.experiment_state
     set total_waterings = v_seq,
         growth_stage    = public.growth_stage_for(v_seq),
         health          = v_health,
         last_watered_at = v_now,
         updated_at      = v_now
   where experiment_id = v_exp.id
  returning * into v_state;

  -- 7. Return the updated state.
  return jsonb_build_object(
    'ok', true,
    'code', 'watered',
    'contribution_number', v_seq,
    'next_eligible_at', v_now + c_cooldown,
    'state', public._state_json(v_exp.slug, v_exp.status, v_state)
  );
end;
$$;

-- ── get_experiment_state ────────────────────────────────────────────────────
-- Read path for GET /api/experiment. Takes the row lock ONLY when a new UTC day
-- needs processing, so the common (polling) case is lock-free.
create function public.get_experiment_state(
  p_slug         text,
  p_visitor_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cooldown constant interval := interval '24 hours';
  v_exp   public.experiments%rowtype;
  v_state public.experiment_state%rowtype;
  v_now   timestamptz := clock_timestamp();
  v_last  timestamptz;
  v_next  timestamptz;
begin
  select * into v_exp from public.experiments where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_state from public.experiment_state where experiment_id = v_exp.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- A new UTC day has started: take the lock, re-check, process once.
  if v_state.last_health_date < (v_now at time zone 'utc')::date then
    perform 1 from public.experiment_state where experiment_id = v_exp.id for update;
    v_now := clock_timestamp();
    perform public._advance_health(v_exp.id, v_now);
    select * into v_state from public.experiment_state where experiment_id = v_exp.id;
  end if;

  if p_visitor_hash is not null and p_visitor_hash ~ '^[0-9a-f]{64}$' then
    select max(w.watered_at) into v_last
    from public.watering_events w
    join public.participants p on p.id = w.participant_id
    where p.experiment_id = v_exp.id and p.visitor_hash = p_visitor_hash;
  end if;

  if v_last is not null and v_now < v_last + c_cooldown then
    v_next := v_last + c_cooldown;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'state',
    'can_water', (v_exp.status = 'active' and v_next is null),
    'next_eligible_at', v_next,
    'state', public._state_json(v_exp.slug, v_exp.status, v_state)
  );
end;
$$;

-- ── hit_rate_limit ──────────────────────────────────────────────────────────
-- Atomic fixed-window counter. Returns true while the caller is within the limit.
create function public.hit_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_key is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Occasional housekeeping so the table stays tiny.
  if random() < 0.01 then
    delete from public.rate_limits
    where window_start < clock_timestamp() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

-- ── Privileges: service role only ───────────────────────────────────────────
revoke all on function public.growth_stage_for(bigint)                      from public, anon, authenticated;
revoke all on function public._advance_health(uuid, timestamptz)           from public, anon, authenticated;
revoke all on function public._state_json(text, text, public.experiment_state) from public, anon, authenticated;
revoke all on function public.water_experiment(text, text, uuid)           from public, anon, authenticated;
revoke all on function public.get_experiment_state(text, text)             from public, anon, authenticated;
revoke all on function public.hit_rate_limit(text, integer, integer)       from public, anon, authenticated;

grant execute on function public.water_experiment(text, text, uuid)     to service_role;
grant execute on function public.get_experiment_state(text, text)       to service_role;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ---------- 20261103000400_seed.sql ----------
-- ============================================================================
-- Seed: stage definitions and the first experiment, "Save the Plant".
-- This is real configuration, not mock data: it creates one experiment with
-- zero waterings. Idempotent, so it is safe to re-run.
-- ============================================================================

insert into public.growth_stages (stage, name, threshold) values
  (0, 'Seed',            0),
  (1, 'Sprout',         25),
  (2, 'Tiny plant',    100),
  (3, 'Growing plant', 300),
  (4, 'Bushy plant',   750),
  (5, 'Flowering plant', 1500),
  (6, 'Legendary plant', 3000)
on conflict (stage) do nothing;

with new_experiment as (
  insert into public.experiments (slug, title, description)
  values (
    'save-the-plant',
    'Can humanity save this plant?',
    'Strangers around the world water one shared plant, once a day each.'
  )
  on conflict (slug) do nothing
  returning id
)
insert into public.experiment_state (experiment_id, health, last_health_date)
select id, 70, (now() at time zone 'utc')::date
from new_experiment
on conflict (experiment_id) do nothing;

-- ---------- 20261103000500_history_and_contributions.sql ----------
-- ============================================================================
-- Read-only aggregate RPCs for the history section and shareable contribution
-- pages. Everything is derived from real watering events. Nothing returned here
-- contains a visitor hash, participant id or request id.
-- ============================================================================

-- Recent per-day totals (oldest first), stage milestones that have actually been
-- reached, and overall totals.
create function public.get_experiment_history(
  p_slug text,
  p_days integer default 14
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exp       public.experiments%rowtype;
  v_days      integer := least(greatest(coalesce(p_days, 14), 1), 90);
  v_daily     jsonb;
  v_milestones jsonb;
  v_waterings bigint;
  v_visitors  bigint;
begin
  select * into v_exp from public.experiments where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb) into v_daily
  from (
    select h.day, h.waterings, h.participants
    from public.experiment_daily_history h
    where h.slug = p_slug
    order by h.day desc
    limit v_days
  ) d;

  select coalesce(jsonb_agg(m order by m.stage), '[]'::jsonb) into v_milestones
  from (
    select ms.stage, ms.name, ms.threshold, ms.reached_at
    from public.experiment_milestones ms
    where ms.slug = p_slug
  ) m;

  select count(*), count(distinct w.participant_id)
    into v_waterings, v_visitors
  from public.watering_events w
  where w.experiment_id = v_exp.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'history',
    'slug', v_exp.slug,
    'started_at', v_exp.created_at,
    'total_waterings', v_waterings,
    'total_visitors', v_visitors,
    'days', v_daily,
    'milestones', v_milestones
  );
end;
$$;

-- One public contribution: "watering number N". The stage shown is the stage the
-- plant reached AT that watering (its sequence number is the running total then).
create function public.get_contribution(
  p_slug   text,
  p_number bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exp public.experiments%rowtype;
  v_at  timestamptz;
  v_stage smallint;
  v_stage_name text;
begin
  if p_number is null or p_number < 1 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_exp from public.experiments where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select w.watered_at into v_at
  from public.watering_events w
  where w.experiment_id = v_exp.id and w.sequence_number = p_number;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_stage := public.growth_stage_for(p_number);
  select g.name into v_stage_name from public.growth_stages g where g.stage = v_stage;

  return jsonb_build_object(
    'ok', true,
    'code', 'contribution',
    'slug', v_exp.slug,
    'contribution_number', p_number,
    'watered_at', v_at,
    'stage', v_stage,
    'stage_name', v_stage_name
  );
end;
$$;

revoke all on function public.get_experiment_history(text, integer) from public, anon, authenticated;
revoke all on function public.get_contribution(text, bigint)        from public, anon, authenticated;
grant execute on function public.get_experiment_history(text, integer) to service_role;
grant execute on function public.get_contribution(text, bigint)        to service_role;

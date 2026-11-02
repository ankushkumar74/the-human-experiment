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

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

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

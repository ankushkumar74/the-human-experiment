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

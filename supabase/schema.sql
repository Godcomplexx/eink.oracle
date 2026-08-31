-- Final account model for Your Own Houdini.
-- Email and login credentials remain in Supabase Auth; application tables use only auth.uid().

create table if not exists public.oracle_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  timezone text not null default 'UTC',
  state_version integer not null default 2,
  deck_version integer not null default 2,
  algorithm_version integer not null default 3
);

create table if not exists public.oracle_journey_state (
  user_id uuid primary key references public.oracle_profiles (id) on delete cascade,
  current_node text not null default 'OPENING',
  last_draw_date date,
  streak integer not null default 0 check (streak >= 0),
  days_without_rare integer not null default 0 check (days_without_rare >= 0),
  unlocked_nodes jsonb not null default '[]'::jsonb,
  completed_sets jsonb not null default '[]'::jsonb,
  found_anomalies jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Versioned account archive used by the current web client. The normalized journey
-- tables below remain the target model for the trusted server-side draw function.
create table if not exists public.oracle_archives (
  user_id uuid primary key references public.oracle_profiles (id) on delete cascade,
  state jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(state) = 'object'),
  check (state ? 'version' and (state ->> 'version')::integer = 2),
  check (state ? 'anonymousId' and jsonb_typeof(state -> 'anonymousId') = 'string'),
  check (state ? 'history' and jsonb_typeof(state -> 'history') = 'array')
);

create or replace function public.validate_oracle_archive_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous_count integer;
  next_count integer;
  previous_date text;
  next_date text;
begin
  if new.revision <> old.revision + 1 then
    raise exception 'archive revision must increase by exactly one';
  end if;

  if new.state ->> 'anonymousId' is distinct from old.state ->> 'anonymousId' then
    raise exception 'archive identity cannot be replaced';
  end if;

  previous_count := jsonb_array_length(old.state -> 'history');
  next_count := jsonb_array_length(new.state -> 'history');

  if next_count = previous_count and new.state is distinct from old.state then
    raise exception 'an existing journey cannot be rewritten';
  end if;

  if next_count = previous_count + 1 then
    if (new.state -> 'history') - (next_count - 1) <> old.state -> 'history' then
      raise exception 'existing observations are immutable';
    end if;

    previous_date := old.state ->> 'lastDate';
    next_date := new.state ->> 'lastDate';
    if next_date is null or (previous_date is not null and next_date <= previous_date) then
      raise exception 'only one new daily observation can be appended';
    end if;
  elsif next_count <> previous_count then
    raise exception 'only one observation can be appended per archive update';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_oracle_archive_update on public.oracle_archives;
create trigger validate_oracle_archive_update
  before update on public.oracle_archives
  for each row execute function public.validate_oracle_archive_update();

create table if not exists public.oracle_draws (
  id text primary key,
  user_id uuid not null references public.oracle_profiles (id) on delete cascade,
  sequence integer not null check (sequence > 0),
  draw_date date not null,
  card_id text not null,
  previous_draw_id text references public.oracle_draws (id) on delete set null,
  previous_state text not null,
  target_state text not null,
  card_state text not null,
  resulting_state text not null,
  theme text not null,
  rarity text not null,
  deck_version integer not null,
  algorithm_version integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, draw_date),
  unique (user_id, sequence)
);

create table if not exists public.oracle_card_observations (
  user_id uuid not null references public.oracle_profiles (id) on delete cascade,
  card_id text not null,
  first_seen date not null,
  last_seen date not null,
  times_seen integer not null default 1 check (times_seen > 0),
  primary key (user_id, card_id)
);

create table if not exists public.oracle_journey_edges (
  id text primary key,
  user_id uuid not null references public.oracle_profiles (id) on delete cascade,
  from_draw_id text references public.oracle_draws (id) on delete set null,
  to_draw_id text not null references public.oracle_draws (id) on delete cascade,
  from_state text not null,
  to_state text not null,
  edge_type text not null check (edge_type in ('PROGRESSION', 'RETURN'))
);

create table if not exists public.oracle_journey_events (
  id text primary key,
  user_id uuid not null references public.oracle_profiles (id) on delete cascade,
  draw_id text not null references public.oracle_draws (id) on delete cascade,
  event_date date not null,
  event_type text not null check (event_type in ('NODE_UNLOCKED', 'ANOMALY_FOUND', 'SET_COMPLETED', 'CONDITION_BYPASS_GRANTED')),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.oracle_push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oracle_profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  reminder_time time not null default '09:00',
  timezone text not null default 'UTC',
  last_sent_date date,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.oracle_profiles enable row level security;
alter table public.oracle_journey_state enable row level security;
alter table public.oracle_archives enable row level security;
alter table public.oracle_draws enable row level security;
alter table public.oracle_card_observations enable row level security;
alter table public.oracle_journey_edges enable row level security;
alter table public.oracle_journey_events enable row level security;
alter table public.oracle_push_subscriptions enable row level security;

drop policy if exists "profiles belong to their owner" on public.oracle_profiles;
create policy "profiles belong to their owner"
  on public.oracle_profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "journey state belongs to its owner" on public.oracle_journey_state;
create policy "journey state belongs to its owner"
  on public.oracle_journey_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "archives belong to their owner" on public.oracle_archives;
create policy "archives belong to their owner"
  on public.oracle_archives for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "draws belong to their owner" on public.oracle_draws;
create policy "draws belong to their owner"
  on public.oracle_draws for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "observations belong to their owner" on public.oracle_card_observations;
create policy "observations belong to their owner"
  on public.oracle_card_observations for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "edges belong to their owner" on public.oracle_journey_edges;
create policy "edges belong to their owner"
  on public.oracle_journey_edges for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "events belong to their owner" on public.oracle_journey_events;
create policy "events belong to their owner"
  on public.oracle_journey_events for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "push subscriptions belong to their owner" on public.oracle_push_subscriptions;
create policy "push subscriptions belong to their owner"
  on public.oracle_push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.oracle_profiles from anon, authenticated;
revoke all on public.oracle_journey_state from anon, authenticated;
revoke all on public.oracle_archives from anon, authenticated;
revoke all on public.oracle_draws from anon, authenticated;
revoke all on public.oracle_card_observations from anon, authenticated;
revoke all on public.oracle_journey_edges from anon, authenticated;
revoke all on public.oracle_journey_events from anon, authenticated;
revoke all on public.oracle_push_subscriptions from anon, authenticated;

grant select, insert, update on public.oracle_profiles to authenticated;
grant select, insert, update on public.oracle_journey_state to authenticated;
grant select, insert, update on public.oracle_archives to authenticated;
grant select on public.oracle_draws to authenticated;
grant select on public.oracle_card_observations to authenticated;
grant select on public.oracle_journey_edges to authenticated;
grant select on public.oracle_journey_events to authenticated;
grant select, insert, update, delete on public.oracle_push_subscriptions to authenticated;

-- Draw creation and collection/graph updates must be performed atomically by a trusted
-- Edge Function. The browser never receives the service-role key and cannot insert draws.

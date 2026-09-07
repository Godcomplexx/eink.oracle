-- Run once in Supabase SQL Editor before deploying the matching web client.
-- It allows append-only branches from separate browsers on the same date.

create or replace function public.validate_oracle_archive_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous_count integer;
  next_count integer;
  observation_index integer;
begin
  if new.revision <> old.revision + 1 then
    raise exception 'archive revision must increase by exactly one';
  end if;

  if new.state ->> 'anonymousId' is distinct from old.state ->> 'anonymousId' then
    raise exception 'archive identity cannot be replaced';
  end if;

  previous_count := jsonb_array_length(old.state -> 'history');
  next_count := jsonb_array_length(new.state -> 'history');

  if next_count < previous_count then
    raise exception 'existing observations cannot be removed';
  end if;

  if previous_count > 0 then
    for observation_index in 0..previous_count - 1 loop
      if new.state -> 'history' -> observation_index
        is distinct from old.state -> 'history' -> observation_index then
        raise exception 'existing observations cannot be rewritten';
      end if;
    end loop;
  end if;

  if next_count = previous_count and new.state is distinct from old.state then
    raise exception 'an existing journey cannot be rewritten';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

alter table public.oracle_draws
  drop constraint if exists oracle_draws_user_id_draw_date_key;

create index if not exists oracle_draws_user_date_idx
  on public.oracle_draws (user_id, draw_date);

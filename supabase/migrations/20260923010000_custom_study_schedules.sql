-- User-chosen schedules keep card membership separate from review history.
-- Calendar dates use date, not timestamptz, to avoid timezone day shifts.
create table public.study_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text null,
  exam_date date null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index study_schedules_user_archive_created_idx
  on public.study_schedules (user_id, archived_at, created_at desc);
create index study_schedules_deck_id_idx
  on public.study_schedules (deck_id);

alter table public.study_schedules enable row level security;
revoke all on table public.study_schedules from public, anon, authenticated;
grant select, insert, delete on table public.study_schedules to authenticated;
grant update (name, description, exam_date, archived_at, updated_at)
  on table public.study_schedules to authenticated;

create policy "Users manage schedules for their own decks"
on public.study_schedules for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id and deck.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id and deck.user_id = (select auth.uid())
  )
);

create table public.study_schedule_cards (
  study_schedule_id uuid not null references public.study_schedules(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  primary key (study_schedule_id, card_id)
);

create index study_schedule_cards_card_id_idx
  on public.study_schedule_cards (card_id);

alter table public.study_schedule_cards enable row level security;
revoke all on table public.study_schedule_cards from public, anon, authenticated;
grant select, insert, delete on table public.study_schedule_cards to authenticated;

create policy "Users manage owned cards in their schedules"
on public.study_schedule_cards for all to authenticated
using (
  exists (
    select 1
    from public.study_schedules as schedule
    join public.cards as card on card.id = card_id
    where schedule.id = study_schedule_id
      and schedule.user_id = (select auth.uid())
      and card.user_id = (select auth.uid())
      and card.deck_id = schedule.deck_id
  )
)
with check (
  exists (
    select 1
    from public.study_schedules as schedule
    join public.cards as card on card.id = card_id
    where schedule.id = study_schedule_id
      and schedule.user_id = (select auth.uid())
      and card.user_id = (select auth.uid())
      and card.deck_id = schedule.deck_id
  )
);

create table public.study_schedule_dates (
  id uuid primary key default gen_random_uuid(),
  study_schedule_id uuid not null references public.study_schedules(id) on delete cascade,
  review_date date not null,
  unique (study_schedule_id, review_date)
);

alter table public.study_schedule_dates enable row level security;
revoke all on table public.study_schedule_dates from public, anon, authenticated;
grant select, insert, delete on table public.study_schedule_dates to authenticated;
grant update (review_date) on table public.study_schedule_dates to authenticated;

create policy "Users manage dates in their schedules"
on public.study_schedule_dates for all to authenticated
using (
  exists (
    select 1 from public.study_schedules as schedule
    where schedule.id = study_schedule_id
      and schedule.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.study_schedules as schedule
    where schedule.id = study_schedule_id
      and schedule.user_id = (select auth.uid())
  )
);

-- Deleting a schedule/date clears the association but retains sessions/reviews.
alter table public.study_sessions
  add column study_schedule_date_id uuid null
  references public.study_schedule_dates(id) on delete set null;

create index study_sessions_schedule_date_started_idx
  on public.study_sessions (study_schedule_date_id, started_at desc)
  where study_schedule_date_id is not null;

-- Unfinished attempts may coexist; only one completion claims a date.
create unique index study_sessions_one_completion_per_schedule_date_idx
  on public.study_sessions (study_schedule_date_id)
  where study_schedule_date_id is not null and completed_at is not null;

-- Existing policies also verify session owner/deck and every selected card.
-- This further requires a dated session to snapshot the schedule selection.
create policy "Scheduled sessions use their own schedule selection"
on public.study_sessions as restrictive for insert to authenticated
with check (
  study_schedule_date_id is null
  or exists (
    select 1
    from public.study_schedule_dates as schedule_date
    join public.study_schedules as schedule
      on schedule.id = schedule_date.study_schedule_id
    where schedule_date.id = study_schedule_date_id
      and schedule.user_id = (select auth.uid())
      and schedule.deck_id = study_sessions.deck_id
      and study_sessions.selected_card_ids = array(
        select selection.card_id
        from public.study_schedule_cards as selection
        join public.cards as card on card.id = selection.card_id
        where selection.study_schedule_id = schedule.id
        order by card.position, card.id
      )
  )
);

-- Trigger functions live outside the exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- The functions are trigger-only: fixed search_path, qualified objects,
-- and no EXECUTE privilege for client roles. No service-role key is used.
create function private.protect_completed_schedule_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.review_date is not distinct from old.review_date then
    return new;
  end if;

  -- A parent delete cascades to dates. Permit this intentional deletion;
  -- the session foreign key sets its date ID to NULL, preserving history.
  if tg_op = 'DELETE'
     and not exists (
       select 1 from public.study_schedules as schedule
       where schedule.id = old.study_schedule_id
     ) then
    return old;
  end if;

  if exists (
    select 1 from public.study_sessions as session
    where session.study_schedule_date_id = old.id
      and session.completed_at is not null
  ) then
    raise exception 'A completed review date cannot be changed or removed'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.protect_completed_schedule_date()
  from public, anon, authenticated;

create trigger protect_completed_schedule_date
before update of review_date or delete on public.study_schedule_dates
for each row execute function private.protect_completed_schedule_date();

create function private.check_scheduled_session_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.study_schedule_date_id is null
     or new.completed_at is not distinct from old.completed_at then
    return new;
  end if;

  if old.completed_at is not null then
    raise exception 'A completed scheduled session cannot be reopened'
      using errcode = '23514';
  end if;

  -- Serializes completion with date edits/deletes and other attempts.
  perform 1 from public.study_schedule_dates as schedule_date
  where schedule_date.id = old.study_schedule_date_id
  for update;
  if not found then
    raise exception 'The scheduled review date is no longer available'
      using errcode = '23503';
  end if;

  if old.selected_card_ids is null
     or exists (
       select 1 from unnest(old.selected_card_ids) as selected(card_id)
       where not exists (
         select 1 from public.card_reviews as review
         where review.study_session_id = old.id
           and review.card_id = selected.card_id
       )
     ) then
    raise exception 'Every selected card must be reviewed before completion'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.study_sessions as completed_session
    where completed_session.study_schedule_date_id = old.study_schedule_date_id
      and completed_session.id <> old.id
      and completed_session.completed_at is not null
  ) then
    -- Another attempt claimed the date. Complete this as an unscheduled
    -- session so its reviews and completion remain in study history.
    new.study_schedule_date_id := null;
  end if;

  return new;
end;
$$;

revoke all on function private.check_scheduled_session_completion()
  from public, anon, authenticated;

create trigger check_scheduled_session_completion
before update of completed_at on public.study_sessions
for each row execute function private.check_scheduled_session_completion();

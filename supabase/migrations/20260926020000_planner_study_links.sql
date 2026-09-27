begin;

-- ==============================================================================
-- Academic Planner — Planner ↔ Study transactional link actions
-- Migration: 20260926020000_planner_study_links.sql
-- ==============================================================================
-- Keeps recurring deck-link edits in the same PostgreSQL transaction as
-- occurrence materialization / future-series splitting, and safely manages
-- Planner ↔ Custom Study Schedule relationships without deleting study data.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Save assignment deck links
-- ------------------------------------------------------------------------------
create or replace function public.save_planner_assignment_decks(
  p_assignment_id uuid,
  p_original_due_date date,
  p_scope text,
  p_deck_ids uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_assignment public.planner_assignments%rowtype;
  v_target_id uuid;
  v_root_id uuid;
  v_split_occurrence_id uuid;
  v_target_semester_id uuid;
  v_split_semester_id uuid;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_scope is null
     or p_scope not in ('this', 'future', 'series')
     or p_deck_ids is null
     or array_position(p_deck_ids, null) is not null
     or cardinality(p_deck_ids) <>
        (select count(distinct selected.id) from unnest(p_deck_ids) as selected(id)) then
    raise exception 'Invalid deck selection' using errcode = '22023';
  end if;

  select * into v_assignment
  from public.planner_assignments
  where id = p_assignment_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Assignment unavailable' using errcode = '42501';
  end if;

  v_root_id := coalesce(v_assignment.parent_series_id, v_assignment.id);

  -- Every requested deck must belong to the current user.
  if exists (
    select 1
    from unnest(p_deck_ids) as selected(id)
    where not exists (
      select 1
      from public.decks d
      where d.id = selected.id
        and d.user_id = v_user_id
    )
  ) then
    raise exception 'Deck unavailable' using errcode = '42501';
  end if;

  if p_scope = 'future' then
    if p_original_due_date is null then
      raise exception 'Invalid future occurrence' using errcode = '22023';
    end if;

    if v_assignment.parent_series_id is null
       and v_assignment.recurrence_kind = 'none' then
      raise exception 'Invalid future occurrence' using errcode = '22023';
    end if;

    -- split_recurring_assignment_series is part of this same PostgreSQL
    -- transaction. Any later failure rolls the split back as well.
    v_target_id := public.split_recurring_assignment_series(
      v_root_id,
      p_original_due_date,
      '{}'::jsonb
    );

    -- The stabilized split RPC preserves an exact concrete split occurrence
    -- (when one exists) using its stable original_due_date identity. For
    -- "This and future", the requested deck set must be applied to BOTH:
    --   1) the new/current future-series root template, and
    --   2) the exact concrete split occurrence.
    -- Other materialized future snapshots remain untouched and independent.
    select a.id, a.semester_id
      into v_split_occurrence_id, v_split_semester_id
    from public.planner_assignments a
    where a.user_id = v_user_id
      and a.parent_series_id = v_target_id
      and a.original_due_date = p_original_due_date
    for update;

  elsif p_scope = 'this' and p_original_due_date is not null then
    v_target_id := public.materialize_recurring_assignment_occurrence(
      v_root_id,
      p_original_due_date,
      '{}'::jsonb
    );

  elsif p_scope = 'series' then
    v_target_id := v_root_id;

  else
    -- A recurring root cannot represent one occurrence without an occurrence
    -- identity. Standalone assignments and concrete materialized occurrences
    -- are valid direct targets.
    if p_scope = 'this'
       and p_original_due_date is null
       and v_assignment.parent_series_id is null
       and v_assignment.recurrence_kind <> 'none' then
      raise exception 'Occurrence date is required for a recurring assignment' using errcode = '22023';
    end if;

    v_target_id := v_assignment.id;
  end if;

  -- Lock and verify the main target (standalone/materialized assignment,
  -- recurring root, or future root returned by the split RPC).
  select a.semester_id
    into v_target_semester_id
  from public.planner_assignments a
  where a.id = v_target_id
    and a.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Assignment unavailable' using errcode = '42501';
  end if;

  -- MAIN TARGET: block removing a deck that still has a Planner-linked study
  -- schedule. The schedule itself is never deleted here.
  if exists (
    select 1
    from public.planner_assignment_study_schedules rel
    join public.study_schedules schedule
      on schedule.id = rel.study_schedule_id
     and schedule.user_id = rel.user_id
    where rel.assignment_id = v_target_id
      and rel.user_id = v_user_id
      and not (schedule.deck_id = any(p_deck_ids))
  ) then
    raise exception 'Unlink its study schedule before removing this deck'
      using errcode = '23514';
  end if;

  delete from public.planner_assignment_decks
  where assignment_id = v_target_id
    and user_id = v_user_id
    and not (deck_id = any(p_deck_ids));

  insert into public.planner_assignment_decks (
    user_id,
    semester_id,
    assignment_id,
    deck_id
  )
  select
    v_user_id,
    v_target_semester_id,
    v_target_id,
    selected.id
  from unnest(p_deck_ids) as selected(id)
  on conflict (assignment_id, deck_id) do nothing;

  -- EXACT SPLIT OCCURRENCE: when "This and future" preserved/materialized the
  -- selected occurrence as a concrete snapshot, explicitly synchronize the
  -- SAME requested deck set on that occurrence too. This is intentionally
  -- separate from the future-root update so the contract is unambiguous.
  if p_scope = 'future'
     and v_split_occurrence_id is not null
     and v_split_occurrence_id <> v_target_id then

    if exists (
      select 1
      from public.planner_assignment_study_schedules rel
      join public.study_schedules schedule
        on schedule.id = rel.study_schedule_id
       and schedule.user_id = rel.user_id
      where rel.assignment_id = v_split_occurrence_id
        and rel.user_id = v_user_id
        and not (schedule.deck_id = any(p_deck_ids))
    ) then
      raise exception 'Unlink its study schedule before removing this deck'
        using errcode = '23514';
    end if;

    delete from public.planner_assignment_decks
    where assignment_id = v_split_occurrence_id
      and user_id = v_user_id
      and not (deck_id = any(p_deck_ids));

    insert into public.planner_assignment_decks (
      user_id,
      semester_id,
      assignment_id,
      deck_id
    )
    select
      v_user_id,
      v_split_semester_id,
      v_split_occurrence_id,
      selected.id
    from unnest(p_deck_ids) as selected(id)
    on conflict (assignment_id, deck_id) do nothing;
  end if;

  return v_target_id;
end;
$$;

revoke all on function public.save_planner_assignment_decks(uuid, date, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.save_planner_assignment_decks(uuid, date, text, uuid[])
  to authenticated;

-- ------------------------------------------------------------------------------
-- 2. Link an existing Custom Study Schedule to an Exam assignment occurrence
-- ------------------------------------------------------------------------------
create or replace function public.link_planner_study_schedule(
  p_assignment_id uuid,
  p_original_due_date date,
  p_study_schedule_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_assignment public.planner_assignments%rowtype;
  v_target_id uuid;
  v_deck_id uuid;
  v_semester_id uuid;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into v_assignment
  from public.planner_assignments
  where id = p_assignment_id
    and user_id = v_user_id;

  if not found or v_assignment.type_kind <> 'exam' then
    raise exception 'Exam unavailable' using errcode = '42501';
  end if;

  select deck_id into v_deck_id
  from public.study_schedules
  where id = p_study_schedule_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Study schedule unavailable' using errcode = '42501';
  end if;

  if p_original_due_date is not null then
    if v_assignment.parent_series_id is not null then
      raise exception 'Invalid occurrence source' using errcode = '22023';
    end if;

    v_target_id := public.materialize_recurring_assignment_occurrence(
      v_assignment.id,
      p_original_due_date,
      '{}'::jsonb
    );
  else
    v_target_id := v_assignment.id;
  end if;

  -- Locking the concrete assignment serializes schedule-link creation for this
  -- target, so concurrent requests cannot create two schedules for the same deck.
  select semester_id into v_semester_id
  from public.planner_assignments
  where id = v_target_id
    and user_id = v_user_id
    and type_kind = 'exam'
  for update;

  if not found then
    raise exception 'Exam unavailable' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.planner_assignment_decks
    where assignment_id = v_target_id
      and user_id = v_user_id
      and deck_id = v_deck_id
  ) then
    raise exception 'Link this deck to the assignment first' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.planner_assignment_study_schedules rel
    join public.study_schedules schedule
      on schedule.id = rel.study_schedule_id
     and schedule.user_id = rel.user_id
    where rel.assignment_id = v_target_id
      and rel.user_id = v_user_id
      and schedule.deck_id = v_deck_id
  ) then
    raise exception 'This deck already has a linked study schedule' using errcode = '23505';
  end if;

  insert into public.planner_assignment_study_schedules (
    user_id,
    semester_id,
    assignment_id,
    study_schedule_id
  ) values (
    v_user_id,
    v_semester_id,
    v_target_id,
    p_study_schedule_id
  );

  return v_target_id;
end;
$$;

revoke all on function public.link_planner_study_schedule(uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.link_planner_study_schedule(uuid, date, uuid)
  to authenticated;

-- ------------------------------------------------------------------------------
-- 3. Unlink Planner relationship only; preserve the Custom Study Schedule
-- ------------------------------------------------------------------------------
create or replace function public.unlink_planner_study_schedule(
  p_assignment_id uuid,
  p_original_due_date date,
  p_study_schedule_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_assignment public.planner_assignments%rowtype;
  v_target_id uuid;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into v_assignment
  from public.planner_assignments
  where id = p_assignment_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Assignment unavailable' using errcode = '42501';
  end if;

  if p_original_due_date is not null then
    if v_assignment.parent_series_id is not null then
      raise exception 'Invalid occurrence source' using errcode = '22023';
    end if;

    v_target_id := public.materialize_recurring_assignment_occurrence(
      v_assignment.id,
      p_original_due_date,
      '{}'::jsonb
    );
  else
    v_target_id := v_assignment.id;
  end if;

  perform 1
  from public.planner_assignments
  where id = v_target_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Assignment unavailable' using errcode = '42501';
  end if;

  delete from public.planner_assignment_study_schedules
  where assignment_id = v_target_id
    and study_schedule_id = p_study_schedule_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Study schedule relationship unavailable' using errcode = '42501';
  end if;

  return v_target_id;
end;
$$;

revoke all on function public.unlink_planner_study_schedule(uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.unlink_planner_study_schedule(uuid, date, uuid)
  to authenticated;

commit;

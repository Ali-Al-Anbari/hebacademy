begin;

-- ==============================================================================
-- Academic Planner — Recurrence Stabilization Fix Pass
-- Migration: 20260926010000_recurrence_stabilization.sql
-- ==============================================================================
-- DO NOT RUN OR APPLY DIRECTLY TO LIVE SUPABASE. PENDING USER REVIEW.
-- Provides transactional, atomic operations for:
-- 1. planner_private.lock_assignment_root: Locks and verifies recurring series root.
-- 2. planner_private.sync_assignment_urls: Atomically replaces URLs for an assignment.
-- 3. planner_private.sync_assignment_subtasks: Atomically replaces subtasks for an assignment.
-- 4. public.materialize_recurring_assignment_occurrence:
--    - Stable-snapshot-first verification
--    - Atomic URL and subtask synchronization inside one PostgreSQL transaction
-- 5. public.split_recurring_assignment_series:
--    - Stable-snapshot-first verification (only validates recurrence rule if no materialized snapshot exists)
--    - Materialized subtask date shifting (v_split_occ_due_delta) preserved
--    - Collision-safe moved-split suppression while preserving stable original_due_date identity
--    - Recurrence rule preservation fallback preventing accidental series termination
--    - Atomic future root + split occurrence URL/subtask synchronization in one transaction
-- 6. public.update_recurring_assignment_series:
--    - Atomic root scalar + recurrence rule + URL + subtask synchronization in one transaction
--    - Preserves all existing materialized occurrence rows untouched
-- ==============================================================================

create schema if not exists planner_private;
revoke all on schema planner_private from public, anon, authenticated;

-- ==============================================================================
-- Internal Series Root Locker Helper
-- ==============================================================================
create or replace function planner_private.lock_assignment_root(
  p_series_id uuid,
  p_user_id uuid
) returns public.planner_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_root public.planner_assignments%rowtype;
begin
  if p_user_id is null or p_series_id is null then
    raise exception 'Invalid parameters for series lock' using errcode = '22000';
  end if;

  select * into v_root
  from public.planner_assignments
  where id = p_series_id
    and user_id = p_user_id
    and parent_series_id is null
  for update;

  if not found then
    raise exception 'Recurring assignment series not found or access denied.' using errcode = 'P0002';
  end if;

  if v_root.recurrence_kind = 'none' then
    raise exception 'Assignment is not recurring.' using errcode = '22000';
  end if;

  return v_root;
end;
$$;

revoke all on function planner_private.lock_assignment_root(uuid, uuid) from public, anon, authenticated;

-- ==============================================================================
-- Internal Atomic URL Synchronizer Helper
-- ==============================================================================
create or replace function planner_private.sync_assignment_urls(
  p_assignment_id uuid,
  p_semester_id uuid,
  p_user_id uuid,
  p_urls jsonb
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_urls is null or jsonb_typeof(p_urls) = 'null' then
    delete from public.planner_assignment_urls
    where assignment_id = p_assignment_id
      and user_id = p_user_id;
    return;
  end if;

  if jsonb_typeof(p_urls) <> 'array' then
    raise exception 'URLs payload must be a JSON array or null.' using errcode = '22000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_urls) as item(elem)
    where nullif(btrim(elem->>'url'), '') is null
       or btrim(elem->>'url') !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Every URL entry must contain a valid http(s) URL.' using errcode = '22000';
  end if;

  delete from public.planner_assignment_urls
  where assignment_id = p_assignment_id
    and user_id = p_user_id;

  insert into public.planner_assignment_urls (
    id,
    user_id,
    semester_id,
    assignment_id,
    url,
    label,
    position
  )
  select
    gen_random_uuid(),
    p_user_id,
    p_semester_id,
    p_assignment_id,
    btrim(elem->>'url'),
    nullif(btrim(elem->>'label'), ''),
    coalesce((elem->>'position')::integer, (ord - 1)::integer)
  from jsonb_array_elements(p_urls) with ordinality as arr(elem, ord);
end;
$$;

revoke all on function planner_private.sync_assignment_urls(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ==============================================================================
-- Internal Atomic Subtask Synchronizer Helper
-- ==============================================================================
create or replace function planner_private.sync_assignment_subtasks(
  p_assignment_id uuid,
  p_semester_id uuid,
  p_user_id uuid,
  p_subtasks jsonb
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_subtasks is null or jsonb_typeof(p_subtasks) = 'null' then
    delete from public.planner_assignment_subtasks
    where assignment_id = p_assignment_id
      and user_id = p_user_id;
    return;
  end if;

  if jsonb_typeof(p_subtasks) <> 'array' then
    raise exception 'Subtasks payload must be a JSON array or null.' using errcode = '22000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_subtasks) as item(elem)
    where nullif(btrim(elem->>'title'), '') is null
       or (
         (elem->>'due_date') is not null
         and (elem->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       )
  ) then
    raise exception 'Every subtask must have a title and any due_date must use YYYY-MM-DD.' using errcode = '22000';
  end if;

  delete from public.planner_assignment_subtasks
  where assignment_id = p_assignment_id
    and user_id = p_user_id;

  insert into public.planner_assignment_subtasks (
    id,
    user_id,
    semester_id,
    assignment_id,
    title,
    is_done,
    due_date,
    position,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    p_user_id,
    p_semester_id,
    p_assignment_id,
    btrim(elem->>'title'),
    coalesce((elem->>'is_done')::boolean, false),
    case
      when (elem->>'due_date') is not null and (elem->>'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then (elem->>'due_date')::date
      else null
    end,
    coalesce((elem->>'position')::integer, (ord - 1)::integer),
    now(),
    now()
  from jsonb_array_elements(p_subtasks) with ordinality as arr(elem, ord);
end;
$$;

revoke all on function planner_private.sync_assignment_subtasks(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ==============================================================================
-- 1. Materialize Occurrence (Atomic with Children)
-- ==============================================================================
create or replace function public.materialize_recurring_assignment_occurrence(
  p_series_id uuid,
  p_original_due_date date,
  p_updates jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
  v_root public.planner_assignments%rowtype;
  v_existing public.planner_assignments%rowtype;
  v_new_id uuid;
  v_day_offset integer;
  v_effective_due_date date;
  v_effective_start_date date;
  v_effective_due_time time without time zone;
  v_effective_status text;
  v_title text;
  v_description text;
  v_planner_course_id uuid;
  v_type_kind text;
  v_custom_type_id uuid;
  v_priority text;
  v_pin record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  -- 1. Lock series root
  v_root := planner_private.lock_assignment_root(p_series_id, v_user_id);

  -- 2. Check if already materialized FIRST (stable-snapshot-first)
  select * into v_existing
  from public.planner_assignments
  where parent_series_id = p_series_id
    and original_due_date = p_original_due_date
    and user_id = v_user_id
    and semester_id = v_root.semester_id
  for update;

  -- 3. Only validate recurrence pattern if no stable materialized snapshot exists
  if v_existing.id is null then
    perform planner_private.validate_recurring_assignment_occurrence(p_series_id, p_original_due_date, v_user_id);
  end if;

  -- Ensure occurrence date is not cancelled
  if exists (
    select 1 from public.planner_assignment_exceptions
    where parent_series_id = p_series_id
      and original_due_date = p_original_due_date
      and user_id = v_user_id
      and kind = 'cancelled'
  ) then
    raise exception 'This recurring occurrence was cancelled.' using errcode = '22000';
  end if;

  -- Parse presence-aware updates
  v_effective_due_date := case
    when p_updates ? 'due_date' and p_updates->>'due_date' is not null and (p_updates->>'due_date') <> '' then
      (p_updates->>'due_date')::date
    when v_existing.id is not null then v_existing.due_date
    else p_original_due_date
  end;

  v_day_offset := v_effective_due_date - v_root.due_date;

  v_effective_start_date := case
    when p_updates ? 'start_date' then
      case
        when p_updates->'start_date' = 'null'::jsonb or p_updates->>'start_date' is null or (p_updates->>'start_date') = '' then null
        else (p_updates->>'start_date')::date
      end
    when v_existing.id is not null then v_existing.start_date
    when v_root.start_date is not null then v_root.start_date + v_day_offset
    else null
  end;

  if v_effective_start_date is not null and v_effective_start_date > v_effective_due_date then
    v_effective_start_date := v_effective_due_date;
  end if;

  v_effective_due_time := case
    when p_updates ? 'due_time' then
      case
        when p_updates->'due_time' = 'null'::jsonb or p_updates->>'due_time' is null or (p_updates->>'due_time') = '' then null
        else (p_updates->>'due_time')::time without time zone
      end
    when v_existing.id is not null then v_existing.due_time
    else v_root.due_time
  end;

  v_title := case
    when p_updates ? 'title' and nullif(btrim(p_updates->>'title'), '') is not null then
      btrim(p_updates->>'title')
    when v_existing.id is not null then v_existing.title
    else v_root.title
  end;

  v_description := case
    when p_updates ? 'description' then
      case
        when p_updates->'description' = 'null'::jsonb or p_updates->>'description' is null then null
        else nullif(btrim(p_updates->>'description'), '')
      end
    when v_existing.id is not null then v_existing.description
    else v_root.description
  end;

  v_planner_course_id := case
    when p_updates ? 'planner_course_id' then
      case
        when p_updates->'planner_course_id' = 'null'::jsonb or p_updates->>'planner_course_id' is null or (p_updates->>'planner_course_id') = '' then null
        else (p_updates->>'planner_course_id')::uuid
      end
    when v_existing.id is not null then v_existing.planner_course_id
    else v_root.planner_course_id
  end;

  v_type_kind := case
    when p_updates ? 'type_kind' and p_updates->>'type_kind' is not null then (p_updates->>'type_kind')
    when v_existing.id is not null then v_existing.type_kind
    else v_root.type_kind
  end;

  v_custom_type_id := case
    when v_type_kind = 'custom' then
      case
        when p_updates ? 'custom_type_id' then
          case
            when p_updates->'custom_type_id' = 'null'::jsonb or p_updates->>'custom_type_id' is null or (p_updates->>'custom_type_id') = '' then null
            else (p_updates->>'custom_type_id')::uuid
          end
        when v_existing.id is not null then v_existing.custom_type_id
        else v_root.custom_type_id
      end
    else null
  end;

  v_effective_status := case
    when p_updates ? 'status' and p_updates->>'status' is not null then (p_updates->>'status')
    when v_existing.id is not null then v_existing.status
    else 'not_started'
  end;

  v_priority := case
    when p_updates ? 'priority' and p_updates->>'priority' is not null then (p_updates->>'priority')
    when v_existing.id is not null then v_existing.priority
    else v_root.priority
  end;

  if v_existing.id is not null then
    -- Update existing materialized occurrence
    update public.planner_assignments
    set
      title = v_title,
      description = v_description,
      planner_course_id = v_planner_course_id,
      start_date = v_effective_start_date,
      due_date = v_effective_due_date,
      due_time = v_effective_due_time,
      type_kind = v_type_kind,
      custom_type_id = v_custom_type_id,
      status = v_effective_status,
      priority = v_priority,
      updated_at = now()
    where id = v_existing.id
      and user_id = v_user_id;

    v_new_id := v_existing.id;

    -- Synchronize URLs atomically if present in updates
    if p_updates ? 'urls' then
      perform planner_private.sync_assignment_urls(v_new_id, v_root.semester_id, v_user_id, p_updates->'urls');
    end if;

    -- Synchronize Subtasks atomically if present in updates; else shift if date changed
    if p_updates ? 'subtasks' then
      perform planner_private.sync_assignment_subtasks(v_new_id, v_root.semester_id, v_user_id, p_updates->'subtasks');
    elsif v_effective_due_date <> v_existing.due_date then
      update public.planner_assignment_subtasks
      set
        due_date = due_date + (v_effective_due_date - v_existing.due_date),
        updated_at = now()
      where assignment_id = v_new_id
        and user_id = v_user_id
        and due_date is not null;
    end if;

  else
    -- Insert new materialized occurrence row
    v_new_id := gen_random_uuid();

    insert into public.planner_assignments (
      id,
      user_id,
      semester_id,
      planner_course_id,
      parent_series_id,
      original_due_date,
      title,
      description,
      start_date,
      due_date,
      due_time,
      type_kind,
      custom_type_id,
      status,
      priority,
      recurrence_kind,
      recurrence_interval,
      recurrence_weekdays,
      recurrence_end_kind,
      recurrence_until,
      created_at,
      updated_at
    ) values (
      v_new_id,
      v_user_id,
      v_root.semester_id,
      v_planner_course_id,
      v_root.id,
      p_original_due_date,
      v_title,
      v_description,
      v_effective_start_date,
      v_effective_due_date,
      v_effective_due_time,
      v_type_kind,
      v_custom_type_id,
      v_effective_status,
      v_priority,
      'none',
      1,
      null,
      'none',
      null,
      now(),
      now()
    );

    -- URLs: if explicitly present in p_updates, sync; else clone from root template
    if p_updates ? 'urls' then
      perform planner_private.sync_assignment_urls(v_new_id, v_root.semester_id, v_user_id, p_updates->'urls');
    else
      insert into public.planner_assignment_urls (
        user_id, semester_id, assignment_id, url, label, position
      )
      select
        v_user_id, v_root.semester_id, v_new_id, url, label, position
      from public.planner_assignment_urls
      where assignment_id = v_root.id and user_id = v_user_id;
    end if;

    -- Subtasks: if explicitly present in p_updates, sync; else clone from root template (shifting by offset)
    if p_updates ? 'subtasks' then
      perform planner_private.sync_assignment_subtasks(v_new_id, v_root.semester_id, v_user_id, p_updates->'subtasks');
    else
      insert into public.planner_assignment_subtasks (
        user_id, semester_id, assignment_id, title, is_done, due_date, position, created_at, updated_at
      )
      select
        v_user_id, v_root.semester_id, v_new_id, title, false,
        case when due_date is not null then due_date + v_day_offset else null end,
        position, now(), now()
      from public.planner_assignment_subtasks
      where assignment_id = v_root.id and user_id = v_user_id;
    end if;

    -- 3. Attachment references (references only; Storage objects are never duplicated)
    insert into public.planner_assignment_attachment_refs (
      user_id, semester_id, assignment_id, attachment_id, position
    )
    select
      v_user_id, v_root.semester_id, v_new_id, attachment_id, position
    from public.planner_assignment_attachment_refs
    where assignment_id = v_root.id and user_id = v_user_id;

    -- 4. Decks
    insert into public.planner_assignment_decks (
      user_id, semester_id, assignment_id, deck_id
    )
    select
      v_user_id, v_root.semester_id, v_new_id, deck_id
    from public.planner_assignment_decks
    where assignment_id = v_root.id and user_id = v_user_id;

    -- 5. Study schedules
    insert into public.planner_assignment_study_schedules (
      user_id, semester_id, assignment_id, study_schedule_id
    )
    select
      v_user_id, v_root.semester_id, v_new_id, study_schedule_id
    from public.planner_assignment_study_schedules
    where assignment_id = v_root.id and user_id = v_user_id;

    -- Retarget virtual Weekly Focus pins for this occurrence
    for v_pin in
      select * from public.planner_weekly_focus_items
      where user_id = v_user_id
        and semester_id = v_root.semester_id
        and assignment_id = v_root.id
        and occurrence_date = p_original_due_date
    loop
      if exists (
        select 1 from public.planner_weekly_focus_items
        where user_id = v_user_id
          and semester_id = v_root.semester_id
          and week_start = v_pin.week_start
          and assignment_id = v_new_id
          and occurrence_date is null
          and id <> v_pin.id
      ) then
        delete from public.planner_weekly_focus_items where id = v_pin.id;
      else
        update public.planner_weekly_focus_items
        set
          assignment_id = v_new_id,
          occurrence_date = null,
          updated_at = now()
        where id = v_pin.id;
      end if;
    end loop;
  end if;

  return v_new_id;
end;
$$;

grant execute on function public.materialize_recurring_assignment_occurrence(uuid, date, jsonb) to authenticated;
revoke all on function public.materialize_recurring_assignment_occurrence(uuid, date, jsonb) from public, anon;

-- ==============================================================================
-- 2. Split Series ("This and future" with Atomic Child Sync)
-- ==============================================================================
create or replace function public.split_recurring_assignment_series(
  p_series_id uuid,
  p_split_date date,
  p_updates jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
  v_old_series public.planner_assignments%rowtype;
  v_split_mat public.planner_assignments%rowtype;
  v_new_series_id uuid;
  v_occ_id uuid;
  v_split_occ_id uuid;
  v_target_series_id uuid;
  v_template_source_id uuid;
  v_template_due_date date;
  v_template_shift integer := 0;
  v_root_due_delta integer := 0;
  v_split_occ_due_delta integer := 0;
  v_pin_offset integer;
  v_base_title text;
  v_base_description text;
  v_base_planner_course_id uuid;
  v_base_start_date date;
  v_base_due_date date;
  v_base_due_time time without time zone;
  v_base_type_kind text;
  v_base_custom_type_id uuid;
  v_base_priority text;
  v_base_status text;
  v_new_title text;
  v_new_description text;
  v_new_planner_course_id uuid;
  v_new_start_date date;
  v_new_due_date date;
  v_new_due_time time without time zone;
  v_new_type_kind text;
  v_new_custom_type_id uuid;
  v_new_priority text;
  v_split_status text;
  v_new_recurrence_kind text;
  v_new_recurrence_interval integer;
  v_new_recurrence_weekdays smallint[];
  v_new_recurrence_end_kind text;
  v_new_recurrence_until date;
  v_has_split_pins boolean := false;
  v_should_materialize_split boolean := false;
  v_pin record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  -- 1. Lock series root
  v_old_series := planner_private.lock_assignment_root(p_series_id, v_user_id);

  -- 2. Check if split-date occurrence was already materialized FIRST (stable-snapshot-first)
  select * into v_split_mat
  from public.planner_assignments
  where user_id = v_user_id
    and semester_id = v_old_series.semester_id
    and parent_series_id = v_old_series.id
    and original_due_date = p_split_date
  for update;

  -- 3. Only validate recurrence pattern if no stable materialized snapshot exists
  if v_split_mat.id is null then
    perform planner_private.validate_recurring_assignment_occurrence(p_series_id, p_split_date, v_user_id);
  end if;

  -- --------------------------------------------------------------------------
  -- Step 1: Pre-materialize strictly future virtual Weekly Focus pins (> p_split_date)
  -- --------------------------------------------------------------------------
  for v_pin in
    select * from public.planner_weekly_focus_items
    where user_id = v_user_id
      and semester_id = v_old_series.semester_id
      and assignment_id = v_old_series.id
      and occurrence_date is not null
      and occurrence_date > p_split_date
  loop
    select id into v_occ_id
    from public.planner_assignments
    where user_id = v_user_id
      and parent_series_id = v_old_series.id
      and original_due_date = v_pin.occurrence_date;

    if v_occ_id is null then
      v_occ_id := gen_random_uuid();
      v_pin_offset := v_pin.occurrence_date - v_old_series.due_date;

      insert into public.planner_assignments (
        id,
        user_id,
        semester_id,
        planner_course_id,
        parent_series_id,
        original_due_date,
        title,
        description,
        start_date,
        due_date,
        due_time,
        type_kind,
        custom_type_id,
        status,
        priority,
        recurrence_kind,
        recurrence_interval,
        recurrence_weekdays,
        recurrence_end_kind,
        recurrence_until,
        created_at,
        updated_at
      ) values (
        v_occ_id,
        v_user_id,
        v_old_series.semester_id,
        v_old_series.planner_course_id,
        v_old_series.id,
        v_pin.occurrence_date,
        v_old_series.title,
        v_old_series.description,
        case when v_old_series.start_date is not null then v_old_series.start_date + v_pin_offset else null end,
        v_pin.occurrence_date,
        v_old_series.due_time,
        v_old_series.type_kind,
        v_old_series.custom_type_id,
        'not_started',
        v_old_series.priority,
        'none',
        1,
        null,
        'none',
        null,
        now(),
        now()
      );

      -- Copy all 5 child relationships to materialized occurrence
      insert into public.planner_assignment_urls (
        user_id, semester_id, assignment_id, url, label, position
      )
      select v_user_id, v_old_series.semester_id, v_occ_id, url, label, position
      from public.planner_assignment_urls
      where assignment_id = v_old_series.id and user_id = v_user_id;

      insert into public.planner_assignment_subtasks (
        user_id, semester_id, assignment_id, title, is_done, due_date, position, created_at, updated_at
      )
      select v_user_id, v_old_series.semester_id, v_occ_id, title, false,
        case when due_date is not null then due_date + v_pin_offset else null end,
        position, now(), now()
      from public.planner_assignment_subtasks
      where assignment_id = v_old_series.id and user_id = v_user_id;

      insert into public.planner_assignment_attachment_refs (
        user_id, semester_id, assignment_id, attachment_id, position
      )
      select v_user_id, v_old_series.semester_id, v_occ_id, attachment_id, position
      from public.planner_assignment_attachment_refs
      where assignment_id = v_old_series.id and user_id = v_user_id;

      insert into public.planner_assignment_decks (
        user_id, semester_id, assignment_id, deck_id
      )
      select v_user_id, v_old_series.semester_id, v_occ_id, deck_id
      from public.planner_assignment_decks
      where assignment_id = v_old_series.id and user_id = v_user_id;

      insert into public.planner_assignment_study_schedules (
        user_id, semester_id, assignment_id, study_schedule_id
      )
      select v_user_id, v_old_series.semester_id, v_occ_id, study_schedule_id
      from public.planner_assignment_study_schedules
      where assignment_id = v_old_series.id and user_id = v_user_id;
    end if;

    -- Retarget Weekly Focus pin to v_occ_id and clear occurrence_date
    if exists (
      select 1 from public.planner_weekly_focus_items
      where user_id = v_user_id
        and semester_id = v_old_series.semester_id
        and week_start = v_pin.week_start
        and assignment_id = v_occ_id
        and occurrence_date is null
        and id <> v_pin.id
    ) then
      delete from public.planner_weekly_focus_items where id = v_pin.id;
    else
      update public.planner_weekly_focus_items
      set
        assignment_id = v_occ_id,
        occurrence_date = null,
        updated_at = now()
      where id = v_pin.id;
    end if;
  end loop;

  -- --------------------------------------------------------------------------
  -- Step 2: Establish effective baseline (from v_split_mat if customized, else v_old_series)
  -- --------------------------------------------------------------------------
  if v_split_mat.id is not null then
    v_base_title := v_split_mat.title;
    v_base_description := v_split_mat.description;
    v_base_planner_course_id := v_split_mat.planner_course_id;
    v_base_start_date := v_split_mat.start_date;
    v_base_due_date := v_split_mat.due_date;
    v_base_due_time := v_split_mat.due_time;
    v_base_type_kind := v_split_mat.type_kind;
    v_base_custom_type_id := v_split_mat.custom_type_id;
    v_base_priority := v_split_mat.priority;
    v_base_status := v_split_mat.status;
    v_template_source_id := v_split_mat.id;
    v_template_due_date := v_split_mat.due_date;
  else
    v_base_title := v_old_series.title;
    v_base_description := v_old_series.description;
    v_base_planner_course_id := v_old_series.planner_course_id;
    v_pin_offset := p_split_date - v_old_series.due_date;
    v_base_start_date := case when v_old_series.start_date is not null then v_old_series.start_date + v_pin_offset else null end;
    v_base_due_date := p_split_date;
    v_base_due_time := v_old_series.due_time;
    v_base_type_kind := v_old_series.type_kind;
    v_base_custom_type_id := v_old_series.custom_type_id;
    v_base_priority := v_old_series.priority;
    v_base_status := 'not_started';
    v_template_source_id := v_old_series.id;
    v_template_due_date := v_old_series.due_date;
  end if;

  -- Resolve presence-aware updates against baseline
  v_new_title := case
    when p_updates ? 'title' and nullif(btrim(p_updates->>'title'), '') is not null then
      btrim(p_updates->>'title')
    else v_base_title
  end;

  v_new_description := case
    when p_updates ? 'description' then
      case
        when p_updates->'description' = 'null'::jsonb or p_updates->>'description' is null then null
        else nullif(btrim(p_updates->>'description'), '')
      end
    else v_base_description
  end;

  v_new_planner_course_id := case
    when p_updates ? 'planner_course_id' then
      case
        when p_updates->'planner_course_id' = 'null'::jsonb or p_updates->>'planner_course_id' is null or (p_updates->>'planner_course_id') = '' then null
        else (p_updates->>'planner_course_id')::uuid
      end
    else v_base_planner_course_id
  end;

  v_new_due_date := case
    when p_updates ? 'due_date' and p_updates->>'due_date' is not null and (p_updates->>'due_date') <> '' then
      (p_updates->>'due_date')::date
    else v_base_due_date
  end;

  v_template_shift := v_new_due_date - v_template_due_date;
  v_root_due_delta := v_new_due_date - v_old_series.due_date;
  if v_split_mat.id is not null then
    v_split_occ_due_delta := v_new_due_date - v_split_mat.due_date;
  end if;

  v_new_start_date := case
    when p_updates ? 'start_date' then
      case
        when p_updates->'start_date' = 'null'::jsonb or p_updates->>'start_date' is null or (p_updates->>'start_date') = '' then null
        else (p_updates->>'start_date')::date
      end
    when v_base_start_date is not null then v_base_start_date + (v_new_due_date - v_base_due_date)
    else null
  end;

  if v_new_start_date is not null and v_new_start_date > v_new_due_date then
    v_new_start_date := v_new_due_date;
  end if;

  v_new_due_time := case
    when p_updates ? 'due_time' then
      case
        when p_updates->'due_time' = 'null'::jsonb or p_updates->>'due_time' is null or (p_updates->>'due_time') = '' then null
        else (p_updates->>'due_time')::time without time zone
      end
    else v_base_due_time
  end;

  v_new_type_kind := case
    when p_updates ? 'type_kind' and p_updates->>'type_kind' is not null then (p_updates->>'type_kind')
    else v_base_type_kind
  end;

  v_new_custom_type_id := case
    when v_new_type_kind = 'custom' then
      case
        when p_updates ? 'custom_type_id' then
          case
            when p_updates->'custom_type_id' = 'null'::jsonb or p_updates->>'custom_type_id' is null or (p_updates->>'custom_type_id') = '' then null
            else (p_updates->>'custom_type_id')::uuid
          end
        else v_base_custom_type_id
      end
    else null
  end;

  v_new_priority := case
    when p_updates ? 'priority' and p_updates->>'priority' is not null then (p_updates->>'priority')
    else v_base_priority
  end;

  -- Status for the exact split occurrence (preserves v_base_status e.g. 'done' if status not in p_updates)
  v_split_status := case
    when p_updates ? 'status' and p_updates->>'status' is not null then (p_updates->>'status')
    else v_base_status
  end;

  -- Recurrence rule parameters for the future series:
  -- Fall back to v_old_series.recurrence_kind if not specified or if set to 'none' without explicit stop flag
  v_new_recurrence_kind := case
    when p_updates ? 'recurrence_kind' and p_updates->>'recurrence_kind' is not null and (p_updates->>'recurrence_kind') <> 'none' then
      (p_updates->>'recurrence_kind')
    when p_updates ? 'recurrence_kind' and (p_updates->>'recurrence_kind') = 'none' and p_updates ? 'explicit_stop_recurrence' and (p_updates->>'explicit_stop_recurrence')::boolean = true then
      'none'
    else v_old_series.recurrence_kind
  end;

  v_new_recurrence_interval := case
    when v_new_recurrence_kind = 'every_x_weeks' then
      case
        when p_updates ? 'recurrence_interval' and (p_updates->>'recurrence_interval') is not null then
          greatest(1, (p_updates->>'recurrence_interval')::integer)
        else greatest(1, coalesce(v_old_series.recurrence_interval, 1))
      end
    else 1
  end;

  v_new_recurrence_weekdays := case
    when v_new_recurrence_kind = 'selected_weekdays' then
      case
        when p_updates ? 'recurrence_weekdays' and p_updates->'recurrence_weekdays' is not null and p_updates->'recurrence_weekdays' <> 'null'::jsonb then
          (select array_agg(elem::smallint) from jsonb_array_elements_text(p_updates->'recurrence_weekdays') as elem)
        else v_old_series.recurrence_weekdays
      end
    else null
  end;

  v_new_recurrence_end_kind := case
    when v_new_recurrence_kind = 'none' then 'none'
    when p_updates ? 'recurrence_end_kind' and p_updates->>'recurrence_end_kind' is not null then (p_updates->>'recurrence_end_kind')
    else v_old_series.recurrence_end_kind
  end;

  v_new_recurrence_until := case
    when v_new_recurrence_end_kind = 'date' then
      case
        when p_updates ? 'recurrence_until' and p_updates->>'recurrence_until' is not null and (p_updates->>'recurrence_until') <> '' then
          (p_updates->>'recurrence_until')::date
        else v_old_series.recurrence_until
      end
    else null
  end;

  -- --------------------------------------------------------------------------
  -- Step 3: Branch split point vs initial root date
  -- --------------------------------------------------------------------------
  if p_split_date <= v_old_series.due_date then
    -- When the split begins at occurrence #1, the existing root remains the
    -- future-series root. Preserve the effective selected snapshot as the
    -- future template without losing attachments/decks/schedules.
    update public.planner_assignments
    set
      title = v_new_title,
      description = v_new_description,
      planner_course_id = v_new_planner_course_id,
      start_date = v_new_start_date,
      due_date = v_new_due_date,
      due_time = v_new_due_time,
      type_kind = v_new_type_kind,
      custom_type_id = v_new_custom_type_id,
      status = 'not_started',
      priority = v_new_priority,
      recurrence_kind = v_new_recurrence_kind,
      recurrence_interval = v_new_recurrence_interval,
      recurrence_weekdays = v_new_recurrence_weekdays,
      recurrence_end_kind = v_new_recurrence_end_kind,
      recurrence_until = v_new_recurrence_until,
      updated_at = now()
    where id = v_old_series.id
      and user_id = v_user_id;

    if v_split_mat.id is not null then
      -- URLs: explicit form payload wins; otherwise the customized occurrence
      -- becomes the future template.
      if p_updates ? 'urls' then
        perform planner_private.sync_assignment_urls(
          v_old_series.id, v_old_series.semester_id, v_user_id, p_updates->'urls'
        );
      else
        delete from public.planner_assignment_urls
        where assignment_id = v_old_series.id and user_id = v_user_id;

        insert into public.planner_assignment_urls (
          user_id, semester_id, assignment_id, url, label, position
        )
        select v_user_id, v_old_series.semester_id, v_old_series.id, url, label, position
        from public.planner_assignment_urls
        where assignment_id = v_split_mat.id and user_id = v_user_id;
      end if;

      -- Subtasks: explicit form payload is already expressed in final dates;
      -- otherwise copy the selected snapshot and shift only by its NEW move.
      if p_updates ? 'subtasks' then
        perform planner_private.sync_assignment_subtasks(
          v_old_series.id, v_old_series.semester_id, v_user_id, p_updates->'subtasks'
        );
      else
        delete from public.planner_assignment_subtasks
        where assignment_id = v_old_series.id and user_id = v_user_id;

        insert into public.planner_assignment_subtasks (
          user_id, semester_id, assignment_id, title, is_done, due_date, position, created_at, updated_at
        )
        select v_user_id, v_old_series.semester_id, v_old_series.id, title, false,
          case when due_date is not null then due_date + v_template_shift else null end,
          position, now(), now()
        from public.planner_assignment_subtasks
        where assignment_id = v_split_mat.id and user_id = v_user_id;
      end if;

      -- The selected materialized occurrence is the effective future template
      -- for relationship types that are not directly editable in this save.
      delete from public.planner_assignment_attachment_refs
      where assignment_id = v_old_series.id and user_id = v_user_id;
      insert into public.planner_assignment_attachment_refs (
        user_id, semester_id, assignment_id, attachment_id, position
      )
      select v_user_id, v_old_series.semester_id, v_old_series.id, attachment_id, position
      from public.planner_assignment_attachment_refs
      where assignment_id = v_split_mat.id and user_id = v_user_id;

      delete from public.planner_assignment_decks
      where assignment_id = v_old_series.id and user_id = v_user_id;
      insert into public.planner_assignment_decks (
        user_id, semester_id, assignment_id, deck_id
      )
      select v_user_id, v_old_series.semester_id, v_old_series.id, deck_id
      from public.planner_assignment_decks
      where assignment_id = v_split_mat.id and user_id = v_user_id;

      delete from public.planner_assignment_study_schedules
      where assignment_id = v_old_series.id and user_id = v_user_id;
      insert into public.planner_assignment_study_schedules (
        user_id, semester_id, assignment_id, study_schedule_id
      )
      select v_user_id, v_old_series.semester_id, v_old_series.id, study_schedule_id
      from public.planner_assignment_study_schedules
      where assignment_id = v_split_mat.id and user_id = v_user_id;

    else
      -- No materialized split snapshot: explicit children replace the root
      -- template; otherwise preserve existing children and shift dated subtasks
      -- if the recurrence anchor itself moved.
      if p_updates ? 'urls' then
        perform planner_private.sync_assignment_urls(
          v_old_series.id, v_old_series.semester_id, v_user_id, p_updates->'urls'
        );
      end if;

      if p_updates ? 'subtasks' then
        perform planner_private.sync_assignment_subtasks(
          v_old_series.id, v_old_series.semester_id, v_user_id, p_updates->'subtasks'
        );
      elsif v_root_due_delta <> 0 then
        update public.planner_assignment_subtasks
        set
          due_date = due_date + v_root_due_delta,
          updated_at = now()
        where assignment_id = v_old_series.id
          and user_id = v_user_id
          and due_date is not null;
      end if;
    end if;

    v_target_series_id := v_old_series.id;
  else
    -- Truncate the old series, but never extend an already-earlier bounded
    -- recurrence merely because a preserved materialized snapshot is split.
    update public.planner_assignments
    set
      recurrence_end_kind = 'date',
      recurrence_until = case
        when v_old_series.recurrence_end_kind = 'date'
          and v_old_series.recurrence_until is not null
          and v_old_series.recurrence_until < (p_split_date - interval '1 day')::date
        then v_old_series.recurrence_until
        else (p_split_date - interval '1 day')::date
      end,
      updated_at = now()
    where id = v_old_series.id
      and user_id = v_user_id;

    v_new_series_id := gen_random_uuid();

    insert into public.planner_assignments (
      id,
      user_id,
      semester_id,
      planner_course_id,
      parent_series_id,
      original_due_date,
      title,
      description,
      start_date,
      due_date,
      due_time,
      type_kind,
      custom_type_id,
      status,
      priority,
      recurrence_kind,
      recurrence_interval,
      recurrence_weekdays,
      recurrence_end_kind,
      recurrence_until,
      created_at,
      updated_at
    ) values (
      v_new_series_id,
      v_user_id,
      v_old_series.semester_id,
      v_new_planner_course_id,
      null,
      null,
      v_new_title,
      v_new_description,
      v_new_start_date,
      v_new_due_date,
      v_new_due_time,
      v_new_type_kind,
      v_new_custom_type_id,
      'not_started',
      v_new_priority,
      v_new_recurrence_kind,
      v_new_recurrence_interval,
      v_new_recurrence_weekdays,
      v_new_recurrence_end_kind,
      v_new_recurrence_until,
      now(),
      now()
    );

    v_target_series_id := v_new_series_id;

    if p_updates ? 'urls' then
      perform planner_private.sync_assignment_urls(
        v_new_series_id, v_old_series.semester_id, v_user_id, p_updates->'urls'
      );
    else
      insert into public.planner_assignment_urls (
        user_id, semester_id, assignment_id, url, label, position
      )
      select v_user_id, v_old_series.semester_id, v_new_series_id, url, label, position
      from public.planner_assignment_urls
      where assignment_id = v_template_source_id and user_id = v_user_id;
    end if;

    if p_updates ? 'subtasks' then
      perform planner_private.sync_assignment_subtasks(
        v_new_series_id, v_old_series.semester_id, v_user_id, p_updates->'subtasks'
      );
    else
      insert into public.planner_assignment_subtasks (
        user_id, semester_id, assignment_id, title, is_done, due_date, position, created_at, updated_at
      )
      select v_user_id, v_old_series.semester_id, v_new_series_id, title, false,
        case when due_date is not null then due_date + v_template_shift else null end,
        position, now(), now()
      from public.planner_assignment_subtasks
      where assignment_id = v_template_source_id and user_id = v_user_id;
    end if;

    insert into public.planner_assignment_attachment_refs (
      user_id, semester_id, assignment_id, attachment_id, position
    )
    select v_user_id, v_old_series.semester_id, v_new_series_id, attachment_id, position
    from public.planner_assignment_attachment_refs
    where assignment_id = v_template_source_id and user_id = v_user_id;

    insert into public.planner_assignment_decks (
      user_id, semester_id, assignment_id, deck_id
    )
    select v_user_id, v_old_series.semester_id, v_new_series_id, deck_id
    from public.planner_assignment_decks
    where assignment_id = v_template_source_id and user_id = v_user_id;

    insert into public.planner_assignment_study_schedules (
      user_id, semester_id, assignment_id, study_schedule_id
    )
    select v_user_id, v_old_series.semester_id, v_new_series_id, study_schedule_id
    from public.planner_assignment_study_schedules
    where assignment_id = v_template_source_id and user_id = v_user_id;

    -- Preserve customized future snapshots unchanged while moving them under
    -- the future root.
    update public.planner_assignments
    set
      parent_series_id = v_new_series_id,
      updated_at = now()
    where parent_series_id = v_old_series.id
      and original_due_date > p_split_date
      and user_id = v_user_id;

    update public.planner_assignment_exceptions
    set parent_series_id = v_new_series_id
    where parent_series_id = v_old_series.id
      and original_due_date >= p_split_date
      and user_id = v_user_id;
  end if;

  -- --------------------------------------------------------------------------
  -- Step 4: Handle the exact split occurrence (p_split_date)
  -- --------------------------------------------------------------------------
  if v_split_mat.id is not null then
    -- Already materialized: preserve its stable original occurrence identity.
    -- A moved new-root virtual anchor is suppressed below with an exception,
    -- avoiding identity collisions with other preserved materialized snapshots.
    update public.planner_assignments
    set
      parent_series_id = case when v_target_series_id <> v_old_series.id then v_target_series_id else parent_series_id end,
      title = v_new_title,
      description = v_new_description,
      planner_course_id = v_new_planner_course_id,
      start_date = v_new_start_date,
      due_date = v_new_due_date,
      due_time = v_new_due_time,
      type_kind = v_new_type_kind,
      custom_type_id = v_new_custom_type_id,
      status = v_split_status,
      priority = v_new_priority,
      updated_at = now()
    where id = v_split_mat.id
      and user_id = v_user_id;

    -- URLs: sync if present
    if p_updates ? 'urls' then
      perform planner_private.sync_assignment_urls(v_split_mat.id, v_old_series.semester_id, v_user_id, p_updates->'urls');
    end if;

    -- Subtasks: sync if present; else shift by v_split_occ_due_delta if moved!
    if p_updates ? 'subtasks' then
      perform planner_private.sync_assignment_subtasks(v_split_mat.id, v_old_series.semester_id, v_user_id, p_updates->'subtasks');
    elsif v_split_occ_due_delta <> 0 then
      update public.planner_assignment_subtasks
      set
        due_date = due_date + v_split_occ_due_delta,
        updated_at = now()
      where assignment_id = v_split_mat.id
        and user_id = v_user_id
        and due_date is not null;
    end if;

    v_split_occ_id := v_split_mat.id;

  else
    -- Check if split occurrence had virtual Weekly Focus pins or non-default status
    select exists (
      select 1 from public.planner_weekly_focus_items
      where user_id = v_user_id
        and semester_id = v_old_series.semester_id
        and assignment_id = v_old_series.id
        and occurrence_date = p_split_date
    ) into v_has_split_pins;

    v_should_materialize_split := v_has_split_pins or (v_split_status <> 'not_started');

    if v_should_materialize_split then
      -- Materialize EXACTLY ONCE using the stable original split-date identity.
      -- If the effective due date moved, the generated new-root anchor is
      -- suppressed below without rewriting this identity.
      v_split_occ_id := gen_random_uuid();

      insert into public.planner_assignments (
        id,
        user_id,
        semester_id,
        planner_course_id,
        parent_series_id,
        original_due_date,
        title,
        description,
        start_date,
        due_date,
        due_time,
        type_kind,
        custom_type_id,
        status,
        priority,
        recurrence_kind,
        recurrence_interval,
        recurrence_weekdays,
        recurrence_end_kind,
        recurrence_until,
        created_at,
        updated_at
      ) values (
        v_split_occ_id,
        v_user_id,
        v_old_series.semester_id,
        v_new_planner_course_id,
        v_target_series_id,
        p_split_date,
        v_new_title,
        v_new_description,
        v_new_start_date,
        v_new_due_date,
        v_new_due_time,
        v_new_type_kind,
        v_new_custom_type_id,
        v_split_status,
        v_new_priority,
        'none',
        1,
        null,
        'none',
        null,
        now(),
        now()
      );

      -- Copy child items EXACTLY ONCE from target template (or p_updates if provided)
      if p_updates ? 'urls' then
        perform planner_private.sync_assignment_urls(v_split_occ_id, v_old_series.semester_id, v_user_id, p_updates->'urls');
      else
        insert into public.planner_assignment_urls (
          user_id, semester_id, assignment_id, url, label, position
        )
        select v_user_id, v_old_series.semester_id, v_split_occ_id, url, label, position
        from public.planner_assignment_urls
        where assignment_id = v_target_series_id and user_id = v_user_id;
      end if;

      if p_updates ? 'subtasks' then
        perform planner_private.sync_assignment_subtasks(v_split_occ_id, v_old_series.semester_id, v_user_id, p_updates->'subtasks');
      else
        insert into public.planner_assignment_subtasks (
          user_id, semester_id, assignment_id, title, is_done, due_date, position, created_at, updated_at
        )
        select v_user_id, v_old_series.semester_id, v_split_occ_id, title, false,
          due_date, position, now(), now()
        from public.planner_assignment_subtasks
        where assignment_id = v_target_series_id and user_id = v_user_id;
      end if;

      insert into public.planner_assignment_attachment_refs (
        user_id, semester_id, assignment_id, attachment_id, position
      )
      select v_user_id, v_old_series.semester_id, v_split_occ_id, attachment_id, position
      from public.planner_assignment_attachment_refs
      where assignment_id = v_target_series_id and user_id = v_user_id;

      insert into public.planner_assignment_decks (
        user_id, semester_id, assignment_id, deck_id
      )
      select v_user_id, v_old_series.semester_id, v_split_occ_id, deck_id
      from public.planner_assignment_decks
      where assignment_id = v_target_series_id and user_id = v_user_id;

      insert into public.planner_assignment_study_schedules (
        user_id, semester_id, assignment_id, study_schedule_id
      )
      select v_user_id, v_old_series.semester_id, v_split_occ_id, study_schedule_id
      from public.planner_assignment_study_schedules
      where assignment_id = v_target_series_id and user_id = v_user_id;

      -- Retarget ALL Weekly Focus pins across all weeks for p_split_date to v_split_occ_id
      for v_pin in
        select * from public.planner_weekly_focus_items
        where user_id = v_user_id
          and semester_id = v_old_series.semester_id
          and assignment_id = v_old_series.id
          and occurrence_date = p_split_date
      loop
        if exists (
          select 1 from public.planner_weekly_focus_items
          where user_id = v_user_id
            and semester_id = v_old_series.semester_id
            and week_start = v_pin.week_start
            and assignment_id = v_split_occ_id
            and occurrence_date is null
            and id <> v_pin.id
        ) then
          delete from public.planner_weekly_focus_items where id = v_pin.id;
        else
          update public.planner_weekly_focus_items
          set
            assignment_id = v_split_occ_id,
            occurrence_date = null,
            updated_at = now()
          where id = v_pin.id;
        end if;
      end loop;
    end if;
  end if;

  -- If the selected occurrence is concrete and its effective due date moved
  -- away from its stable original identity, suppress the new root's generated
  -- virtual anchor. If another preserved materialized snapshot already owns
  -- that anchor identity, that row itself suppresses the virtual occurrence and
  -- no cancellation row is needed. This preserves BOTH concrete snapshots and
  -- avoids the unique(parent_series_id, original_due_date) collision entirely.
  if v_split_occ_id is not null and v_new_due_date <> p_split_date then
    begin
      perform planner_private.validate_recurring_assignment_occurrence(
        v_target_series_id, v_new_due_date, v_user_id
      );

      if not exists (
        select 1
        from public.planner_assignments
        where parent_series_id = v_target_series_id
          and original_due_date = v_new_due_date
          and user_id = v_user_id
          and semester_id = v_old_series.semester_id
          and id <> v_split_occ_id
      ) then
        insert into public.planner_assignment_exceptions (
          user_id,
          semester_id,
          parent_series_id,
          original_due_date,
          kind
        ) values (
          v_user_id,
          v_old_series.semester_id,
          v_target_series_id,
          v_new_due_date,
          'cancelled'
        )
        on conflict (parent_series_id, original_due_date) do nothing;
      end if;
    exception
      when sqlstate '22000' then
        -- The moved effective date is not generated by the resulting rule (or
        -- recurrence was explicitly stopped), so there is no virtual duplicate
        -- to suppress.
        null;
    end;
  end if;

  return v_target_series_id;
end;
$$;

grant execute on function public.split_recurring_assignment_series(uuid, date, jsonb) to authenticated;
revoke all on function public.split_recurring_assignment_series(uuid, date, jsonb) from public, anon;

-- ==============================================================================
-- 3. Update Entire Recurring Series (Atomic with Children)
-- ==============================================================================
create or replace function public.update_recurring_assignment_series(
  p_series_id uuid,
  p_updates jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
  v_root public.planner_assignments%rowtype;
  v_title text;
  v_description text;
  v_planner_course_id uuid;
  v_start_date date;
  v_due_date date;
  v_due_time time without time zone;
  v_type_kind text;
  v_custom_type_id uuid;
  v_priority text;
  v_recurrence_kind text;
  v_recurrence_interval integer;
  v_recurrence_weekdays smallint[];
  v_recurrence_end_kind text;
  v_recurrence_until date;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  -- 1. Lock and verify owned series root
  v_root := planner_private.lock_assignment_root(p_series_id, v_user_id);

  -- 2. Resolve scalar updates against v_root
  v_title := case
    when p_updates ? 'title' and nullif(btrim(p_updates->>'title'), '') is not null then
      btrim(p_updates->>'title')
    else v_root.title
  end;

  v_description := case
    when p_updates ? 'description' then
      case
        when p_updates->'description' = 'null'::jsonb or p_updates->>'description' is null then null
        else nullif(btrim(p_updates->>'description'), '')
      end
    else v_root.description
  end;

  v_planner_course_id := case
    when p_updates ? 'planner_course_id' then
      case
        when p_updates->'planner_course_id' = 'null'::jsonb or p_updates->>'planner_course_id' is null or (p_updates->>'planner_course_id') = '' then null
        else (p_updates->>'planner_course_id')::uuid
      end
    else v_root.planner_course_id
  end;

  if v_planner_course_id is not null then
    if not exists (
      select 1 from public.planner_courses
      where id = v_planner_course_id
        and semester_id = v_root.semester_id
        and user_id = v_user_id
    ) then
      raise exception 'The selected planner class is not available in this semester.' using errcode = '22000';
    end if;
  end if;

  v_due_date := case
    when p_updates ? 'due_date' and p_updates->>'due_date' is not null and (p_updates->>'due_date') <> '' then
      (p_updates->>'due_date')::date
    else v_root.due_date
  end;

  v_start_date := case
    when p_updates ? 'start_date' then
      case
        when p_updates->'start_date' = 'null'::jsonb or p_updates->>'start_date' is null or (p_updates->>'start_date') = '' then null
        else (p_updates->>'start_date')::date
      end
    else v_root.start_date
  end;

  if v_start_date is not null and v_start_date > v_due_date then
    v_start_date := v_due_date;
  end if;

  v_due_time := case
    when p_updates ? 'due_time' then
      case
        when p_updates->'due_time' = 'null'::jsonb or p_updates->>'due_time' is null or (p_updates->>'due_time') = '' then null
        else (p_updates->>'due_time')::time without time zone
      end
    else v_root.due_time
  end;

  v_type_kind := case
    when p_updates ? 'type_kind' and p_updates->>'type_kind' is not null then (p_updates->>'type_kind')
    else v_root.type_kind
  end;

  v_custom_type_id := case
    when v_type_kind = 'custom' then
      case
        when p_updates ? 'custom_type_id' then
          case
            when p_updates->'custom_type_id' = 'null'::jsonb or p_updates->>'custom_type_id' is null or (p_updates->>'custom_type_id') = '' then null
            else (p_updates->>'custom_type_id')::uuid
          end
        else v_root.custom_type_id
      end
    else null
  end;

  if v_custom_type_id is not null then
    if not exists (
      select 1 from public.planner_custom_assignment_types
      where id = v_custom_type_id
        and user_id = v_user_id
    ) then
      raise exception 'The selected custom type is not available.' using errcode = '22000';
    end if;
  end if;

  v_priority := case
    when p_updates ? 'priority' and p_updates->>'priority' is not null then (p_updates->>'priority')
    else v_root.priority
  end;

  -- Recurrence rule parameters:
  v_recurrence_kind := case
    when p_updates ? 'recurrence_kind' and p_updates->>'recurrence_kind' is not null and (p_updates->>'recurrence_kind') <> 'none' then
      (p_updates->>'recurrence_kind')
    when p_updates ? 'recurrence_kind' and (p_updates->>'recurrence_kind') = 'none' and p_updates ? 'explicit_stop_recurrence' and (p_updates->>'explicit_stop_recurrence')::boolean = true then
      'none'
    else v_root.recurrence_kind
  end;

  v_recurrence_interval := case
    when v_recurrence_kind = 'every_x_weeks' then
      case
        when p_updates ? 'recurrence_interval' and (p_updates->>'recurrence_interval') is not null then
          greatest(1, (p_updates->>'recurrence_interval')::integer)
        else greatest(1, coalesce(v_root.recurrence_interval, 1))
      end
    else 1
  end;

  v_recurrence_weekdays := case
    when v_recurrence_kind = 'selected_weekdays' then
      case
        when p_updates ? 'recurrence_weekdays' and p_updates->'recurrence_weekdays' is not null and p_updates->'recurrence_weekdays' <> 'null'::jsonb then
          (select array_agg(elem::smallint) from jsonb_array_elements_text(p_updates->'recurrence_weekdays') as elem)
        else v_root.recurrence_weekdays
      end
    else null
  end;

  v_recurrence_end_kind := case
    when v_recurrence_kind = 'none' then 'none'
    when p_updates ? 'recurrence_end_kind' and p_updates->>'recurrence_end_kind' is not null then (p_updates->>'recurrence_end_kind')
    else v_root.recurrence_end_kind
  end;

  v_recurrence_until := case
    when v_recurrence_end_kind = 'date' then
      case
        when p_updates ? 'recurrence_until' and p_updates->>'recurrence_until' is not null and (p_updates->>'recurrence_until') <> '' then
          (p_updates->>'recurrence_until')::date
        else v_root.recurrence_until
      end
    else null
  end;

  -- 3. Update root series row (status of root is always preserved or 'not_started' template)
  update public.planner_assignments
  set
    title = v_title,
    description = v_description,
    planner_course_id = v_planner_course_id,
    start_date = v_start_date,
    due_date = v_due_date,
    due_time = v_due_time,
    type_kind = v_type_kind,
    custom_type_id = v_custom_type_id,
    priority = v_priority,
    recurrence_kind = v_recurrence_kind,
    recurrence_interval = v_recurrence_interval,
    recurrence_weekdays = v_recurrence_weekdays,
    recurrence_end_kind = v_recurrence_end_kind,
    recurrence_until = v_recurrence_until,
    updated_at = now()
  where id = v_root.id
    and user_id = v_user_id;

  -- 4. Atomically sync root URLs if present in p_updates
  if p_updates ? 'urls' then
    perform planner_private.sync_assignment_urls(v_root.id, v_root.semester_id, v_user_id, p_updates->'urls');
  end if;

  -- 5. Atomically sync root subtasks if present. Otherwise, if the
  -- series anchor moved, keep existing dated template subtasks aligned.
  if p_updates ? 'subtasks' then
    perform planner_private.sync_assignment_subtasks(v_root.id, v_root.semester_id, v_user_id, p_updates->'subtasks');
  elsif v_due_date <> v_root.due_date then
    update public.planner_assignment_subtasks
    set
      due_date = due_date + (v_due_date - v_root.due_date),
      updated_at = now()
    where assignment_id = v_root.id
      and user_id = v_user_id
      and due_date is not null;
  end if;

  return v_root.id;
end;
$$;

grant execute on function public.update_recurring_assignment_series(uuid, jsonb) to authenticated;
revoke all on function public.update_recurring_assignment_series(uuid, jsonb) from public, anon;

commit;

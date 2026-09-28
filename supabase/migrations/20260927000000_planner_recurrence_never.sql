      if v_day_diff % v_interval = 0 then
        v_is_valid := true;
      end if;

    when 'weekly' then
      if extract(isodow from p_target_date) = extract(isodow from v_root.due_date)
         and v_day_diff % 7 = 0 then
        v_is_valid := true;
      end if;

    when 'every_x_weeks' then
      if extract(isodow from p_target_date) = extract(isodow from v_root.due_date)
         and v_day_diff % (v_interval * 7) = 0 then
        v_is_valid := true;
      end if;

    when 'selected_weekdays' then
      if v_root.recurrence_weekdays is not null
         and extract(isodow from p_target_date)::smallint = any(v_root.recurrence_weekdays) then
        v_is_valid := true;
      end if;

    when 'monthly' then
      if extract(day from p_target_date) = extract(day from v_root.due_date) then
        v_is_valid := true;
      end if;

    else
      v_is_valid := false;
  end case;

  if not v_is_valid then
    raise exception 'Date % is not a valid recurrence occurrence for series %.', p_target_date, p_series_id using errcode = '22000';
  end if;

  return v_root;
end;
$$;

revoke all on function planner_private.validate_recurring_assignment_occurrence(uuid, date, uuid)
  from public, anon, authenticated;

-- Complete one virtual subtask without touching the series template. Locking
-- the root serializes this check with the existing materialization RPC, so a
-- concurrent customization cannot have its child snapshot overwritten.
create function public.complete_planner_virtual_subtask(
  p_series_id uuid,
  p_original_due_date date,
  p_template_subtask_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_root public.planner_assignments%rowtype;
  v_subtasks jsonb;
begin
  if v_user_id is null or p_original_due_date is null then
    raise exception 'Unauthorized or invalid occurrence' using errcode = '42501';
  end if;

  select * into v_root from public.planner_assignments
  where id = p_series_id and user_id = v_user_id
    and parent_series_id is null and recurrence_kind <> 'none'
  for update;
  if not found then
    raise exception 'Recurring assignment unavailable' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.planner_assignments
    where parent_series_id = p_series_id
      and original_due_date = p_original_due_date
      and user_id = v_user_id
  ) then
    raise exception 'Occurrence already materialized; refresh and retry' using errcode = '23505';
  end if;

  if not exists (
    select 1 from public.planner_assignment_subtasks
    where id = p_template_subtask_id
      and assignment_id = p_series_id
      and user_id = v_user_id
  ) then
    raise exception 'Subtask unavailable' using errcode = '42501';
  end if;

  select jsonb_agg(jsonb_build_object(
    'title', task.title,
    'is_done', task.id = p_template_subtask_id,
    'due_date', case when task.due_date is null then null
      else task.due_date + (p_original_due_date - v_root.due_date) end,
    'position', task.position
  ) order by task.position, task.id) into v_subtasks
  from public.planner_assignment_subtasks as task
  where task.assignment_id = p_series_id and task.user_id = v_user_id;

  return public.materialize_recurring_assignment_occurrence(
    p_series_id, p_original_due_date,
    jsonb_build_object('subtasks', v_subtasks)
  );
end;
$$;

revoke all on function public.complete_planner_virtual_subtask(uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_planner_virtual_subtask(uuid, date, uuid)
  to authenticated;

commit;

-- A manually pinned assignment may have its own editable Weekly Focus label.
-- Completion continues to belong to the assignment; the pin keeps its identity and position.
begin;
do $$
declare
  old_constraint name;
begin
  select conname into old_constraint
  from pg_constraint
  where conrelid = 'public.planner_weekly_focus_items'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%assignment_id%';
  if old_constraint is null then
    raise exception 'Weekly Focus content constraint was not found';
  end if;
  execute format('alter table public.planner_weekly_focus_items drop constraint %I', old_constraint);
end $$;

alter table public.planner_weekly_focus_items
  add constraint planner_weekly_focus_items_content_check check (
    (assignment_id is null and occurrence_date is null
      and title is not null and length(btrim(title)) > 0)
    or (assignment_id is not null and not is_done
      and (title is null or length(btrim(title)) > 0))
  );
commit;

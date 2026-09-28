alter table public.courses
  add column last_visited_at timestamptz null;

create function public.record_course_visit(p_course_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.courses
  set last_visited_at = now()
  where id = p_course_id
    and user_id = (select auth.uid());
$$;

revoke all on function public.record_course_visit(uuid) from public, anon, authenticated;
grant execute on function public.record_course_visit(uuid) to authenticated;

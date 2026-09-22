create table public.decks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index decks_user_id_idx on public.decks (user_id);
create index decks_course_id_idx on public.decks (course_id);

alter table public.decks enable row level security;

revoke all on table public.decks from public, anon;
grant select, insert, update, delete on table public.decks to authenticated;

create policy "Users can view decks in their courses"
on public.decks for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.courses as course
    where course.id = course_id
      and course.user_id = (select auth.uid())
  )
);

create policy "Users can create decks in their courses"
on public.decks for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.courses as course
    where course.id = course_id
      and course.user_id = (select auth.uid())
  )
);

create policy "Users can update decks in their courses"
on public.decks for update to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.courses as course
    where course.id = course_id
      and course.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.courses as course
    where course.id = course_id
      and course.user_id = (select auth.uid())
  )
);

create policy "Users can delete decks in their courses"
on public.decks for delete to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.courses as course
    where course.id = course_id
      and course.user_id = (select auth.uid())
  )
);

-- Weekly Focus placement is independent of recurring assignment identity.
begin;
alter table public.planner_weekly_focus_items add column focus_date date;

update public.planner_weekly_focus_items as focus
set focus_date = case
  when focus.assignment_id is null then focus.week_start
  when focus.occurrence_date between focus.week_start and focus.week_start + 6 then focus.occurrence_date
  when assignment.due_date between focus.week_start and focus.week_start + 6 then assignment.due_date
  else focus.week_start
end
from public.planner_assignments as assignment
where focus.assignment_id = assignment.id;

update public.planner_weekly_focus_items
set focus_date = week_start
where focus_date is null;

alter table public.planner_weekly_focus_items
  alter column focus_date set not null,
  add constraint planner_focus_date_in_week check (focus_date between week_start and week_start + 6);

create index planner_focus_day_order_idx on public.planner_weekly_focus_items
  (user_id, semester_id, week_start, focus_date, position);

create table public.planner_weekly_notepads (
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  week_start date not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, semester_id, week_start),
  constraint planner_notepad_monday check (extract(isodow from week_start) = 1),
  constraint planner_notepad_semester_owner foreign key (semester_id, user_id)
    references public.planner_semesters(id, user_id) on delete cascade
);

create table public.user_sticky_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  color text not null default 'yellow'
    check (color in ('yellow', 'pink', 'blue', 'green', 'purple')),
  x integer not null default 24 check (x >= 0),
  y integer not null default 88 check (y >= 0),
  width integer not null default 260 check (width between 220 and 1200),
  height integer not null default 220 check (height between 140 and 1000),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_sticky_notes_user_created_idx on public.user_sticky_notes (user_id, created_at desc);

alter table public.planner_weekly_notepads enable row level security;
alter table public.user_sticky_notes enable row level security;

create policy planner_weekly_notepad_owner on public.planner_weekly_notepads
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sticky_note_owner on public.user_sticky_notes
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.planner_weekly_notepads to authenticated;
grant select, insert, update, delete on public.user_sticky_notes to authenticated;

commit;

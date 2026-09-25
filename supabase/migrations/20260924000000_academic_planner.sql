-- Academic Planner. Apply only after checking the live-schema preflight.
-- All calendar days are DATE values; recurring occurrences are generated for
-- a requested window, with sparse cancellations and materialized overrides.
begin;

-- The live preflight confirmed these three owner-pair keys do not yet exist.
-- They let planner foreign keys enforce ownership without trusting RLS alone.
alter table public.courses
  add constraint courses_id_user_id_key unique (id, user_id);
alter table public.decks
  add constraint decks_id_user_id_key unique (id, user_id);
alter table public.study_schedules
  add constraint study_schedules_id_user_id_key unique (id, user_id);

create table public.planner_semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  start_date date not null,
  end_date date not null,
  time_zone text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planner_semesters_dates_check check (end_date >= start_date),
  unique (id, user_id)
);

create table public.planner_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  hebacademy_course_id uuid,
  name text not null check (length(btrim(name)) > 0),
  color text not null default '#FB6F92'
    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (semester_id, user_id)
    references public.planner_semesters(id, user_id) on delete cascade,
  foreign key (hebacademy_course_id, user_id)
    references public.courses(id, user_id)
    on delete set null (hebacademy_course_id),
  unique (id, user_id, semester_id)
);

create table public.planner_course_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  planner_course_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO Monday=1
  starts_at time without time zone not null,
  ends_at time without time zone not null,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (planner_course_id, user_id, semester_id)
    references public.planner_courses(id, user_id, semester_id)
    on delete cascade,
  unique (id, user_id, semester_id),
  unique (planner_course_id, weekday, starts_at, ends_at)
);

create table public.planner_meeting_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  meeting_id uuid not null,
  original_date date not null,
  kind text not null check (kind in ('cancelled', 'changed')),
  replacement_date date,
  replacement_starts_at time without time zone,
  replacement_ends_at time without time zone,
  replacement_location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'cancelled'
      and replacement_date is null and replacement_starts_at is null
      and replacement_ends_at is null and replacement_location is null)
    or (kind = 'changed'
      and (replacement_date is not null or replacement_starts_at is not null
        or replacement_ends_at is not null or replacement_location is not null))
  ),
  check (
    (replacement_starts_at is null) = (replacement_ends_at is null)
    and (replacement_starts_at is null
      or replacement_ends_at > replacement_starts_at)
  ),
  foreign key (meeting_id, user_id, semester_id)
    references public.planner_course_meetings(id, user_id, semester_id)
    on delete cascade,
  unique (meeting_id, original_date)
);

create table public.planner_custom_assignment_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index planner_custom_assignment_types_user_name_idx
  on public.planner_custom_assignment_types (user_id, lower(btrim(name)));

-- A root is a standalone assignment or a recurrence rule. A materialized
-- occurrence has parent_series_id + original_due_date and keeps its own
-- stable dates, status, and child content. The root's due_date is the anchor.
create table public.planner_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  planner_course_id uuid,
  parent_series_id uuid,
  original_due_date date,
  title text not null check (length(btrim(title)) > 0),
  description text,
  start_date date,
  due_date date not null,
  due_time time without time zone,
  type_kind text not null check (type_kind in
    ('homework', 'quiz', 'exam', 'lab', 'reading', 'project',
     'discussion', 'other', 'custom')),
  custom_type_id uuid,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'done')),
  priority text not null default 'normal'
    check (priority in ('normal', 'important')),
  recurrence_kind text not null default 'none'
    check (recurrence_kind in
      ('none', 'daily', 'selected_weekdays', 'weekly', 'every_x_weeks', 'monthly')),
  recurrence_interval integer not null default 1
    check (recurrence_interval > 0),
  recurrence_weekdays smallint[],
  recurrence_end_kind text not null default 'none'
    check (recurrence_end_kind in ('none', 'semester_end', 'date', 'never')),
  recurrence_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planner_assignments_dates_check
    check (start_date is null or start_date <= due_date),
  constraint planner_assignments_type_check
    check ((type_kind = 'custom') = (custom_type_id is not null)),
  constraint planner_assignments_shape_check check (
    (parent_series_id is null and original_due_date is null)
    or (parent_series_id is not null and original_due_date is not null)
  ),
  constraint planner_assignments_rule_check check (
    (recurrence_kind = 'none' and recurrence_end_kind = 'none'
      and recurrence_until is null and recurrence_weekdays is null
      and recurrence_interval = 1)
    or
    (parent_series_id is null and recurrence_kind <> 'none'
      and recurrence_end_kind <> 'none'
      and ((recurrence_end_kind = 'date' and recurrence_until >= due_date)
        or (recurrence_end_kind <> 'date' and recurrence_until is null))
      and (
        (recurrence_kind = 'selected_weekdays'
          and recurrence_weekdays is not null
          and cardinality(recurrence_weekdays) between 1 and 7
          and recurrence_weekdays <@ array[1,2,3,4,5,6,7]::smallint[])
        or (recurrence_kind <> 'selected_weekdays'
          and recurrence_weekdays is null)
      )
      and (recurrence_kind = 'every_x_weeks'
        or recurrence_interval = 1))
  ),
  foreign key (semester_id, user_id)
    references public.planner_semesters(id, user_id) on delete cascade,
  foreign key (planner_course_id, user_id, semester_id)
    references public.planner_courses(id, user_id, semester_id)
    on delete set null (planner_course_id),
  foreign key (parent_series_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade,
  foreign key (custom_type_id, user_id)
    references public.planner_custom_assignment_types(id, user_id)
    on delete no action deferrable initially deferred,
  unique (id, user_id, semester_id),
  unique (parent_series_id, original_due_date)
);

-- A cancellation is the only unmaterialized exception. Moves/edits create a
-- materialized occurrence instead; a transactional RPC must avoid both states
-- for the same original date and verify the root generates that date.
-- That RPC will copy root URLs, subtasks, attachment references, deck links,
-- and schedule links in one transaction. It will shift dated subtasks by the
-- occurrence's date offset and never copy a Storage object. Future-series
-- splits must retarget virtual Weekly Focus pins and reparent future overrides.
create table public.planner_assignment_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  parent_series_id uuid not null,
  original_due_date date not null,
  kind text not null default 'cancelled' check (kind = 'cancelled'),
  created_at timestamptz not null default now(),
  foreign key (parent_series_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade,
  unique (parent_series_id, original_due_date)
);

create table public.planner_assignment_urls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  assignment_id uuid not null,
  url text not null check (url ~* '^https?://[^[:space:]]+$'),
  label text,
  position integer not null default 0 check (position >= 0),
  foreign key (assignment_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade
);

create table public.planner_assignment_subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  assignment_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  is_done boolean not null default false,
  due_date date,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (assignment_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade
);

-- Object registry: assignment_id is the immutable upload-origin ID encoded in
-- the path, not a live FK. References below determine lifetime. Thus deleting
-- a root after a series split cannot destroy a file still used by a snapshot.
create table public.planner_assignment_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  assignment_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (length(btrim(file_name)) > 0),
  content_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  created_at timestamptz not null default now(),
  constraint planner_attachment_path_check check (
    cardinality(string_to_array(storage_path, '/')) = 4
    and split_part(storage_path, '/', 1) = user_id::text
    and split_part(storage_path, '/', 2) = assignment_id::text
    and split_part(storage_path, '/', 3) = id::text
    and split_part(storage_path, '/', 4) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  foreign key (semester_id, user_id)
    references public.planner_semesters(id, user_id) on delete cascade,
  unique (id, user_id, semester_id)
);

create table public.planner_assignment_attachment_refs (
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  assignment_id uuid not null,
  attachment_id uuid not null,
  position integer not null default 0 check (position >= 0),
  primary key (assignment_id, attachment_id),
  foreign key (assignment_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade,
  foreign key (attachment_id, user_id, semester_id)
    references public.planner_assignment_attachments(id, user_id, semester_id)
    on delete cascade
);

create table public.planner_assignment_decks (
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  assignment_id uuid not null,
  deck_id uuid not null,
  primary key (assignment_id, deck_id),
  foreign key (assignment_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade,
  foreign key (deck_id, user_id)
    references public.decks(id, user_id) on delete cascade
);

create table public.planner_assignment_study_schedules (
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  assignment_id uuid not null,
  study_schedule_id uuid not null,
  primary key (assignment_id, study_schedule_id),
  foreign key (assignment_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade,
  foreign key (study_schedule_id, user_id)
    references public.study_schedules(id, user_id) on delete cascade
);

create table public.planner_course_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  planner_course_id uuid not null,
  note_date date not null,
  body text not null check (length(btrim(body)) > 0),
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (planner_course_id, user_id, semester_id)
    references public.planner_courses(id, user_id, semester_id)
    on delete cascade
);

-- Freeform completion lives here. Pinned completion is always read/written on
-- the referenced assignment. Virtual pins use occurrence_date; on first edit
-- the future RPC materializes that occurrence and retargets the pin to it.
create table public.planner_weekly_focus_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null,
  week_start date not null,
  position integer not null default 0 check (position >= 0),
  title text,
  is_done boolean not null default false,
  assignment_id uuid,
  occurrence_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (extract(isodow from week_start) = 1),
  check (
    (assignment_id is null and occurrence_date is null
      and title is not null and length(btrim(title)) > 0)
    or (assignment_id is not null and title is null and not is_done)
  ),
  foreign key (semester_id, user_id)
    references public.planner_semesters(id, user_id) on delete cascade,
  foreign key (assignment_id, user_id, semester_id)
    references public.planner_assignments(id, user_id, semester_id)
    on delete cascade
);

-- Storage removes are performed after commit by authenticated application
-- cleanup. The queue survives deletion of the origin assignment/semester.
create table public.planner_attachment_cleanup (
  storage_path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  queued_at timestamptz not null default now()
);

-- Indexes for calendar windows, joins, dated subtasks, and focus navigation.
create index planner_semesters_user_archive_idx
  on public.planner_semesters (user_id, archived_at, start_date desc);
create index planner_courses_semester_idx
  on public.planner_courses (user_id, semester_id, name);
create index planner_courses_hebacademy_idx
  on public.planner_courses (hebacademy_course_id)
  where hebacademy_course_id is not null;
create index planner_meetings_course_weekday_idx
  on public.planner_course_meetings (planner_course_id, weekday);
create index planner_meeting_exceptions_date_idx
  on public.planner_meeting_exceptions (user_id, semester_id, original_date);
create index planner_assignments_calendar_idx
  on public.planner_assignments (user_id, semester_id, due_date, status);
create index planner_assignments_start_idx
  on public.planner_assignments (user_id, semester_id, start_date)
  where start_date is not null;
create index planner_assignments_course_due_idx
  on public.planner_assignments (planner_course_id, due_date);
create index planner_assignments_type_idx
  on public.planner_assignments (user_id, type_kind, custom_type_id);
create index planner_assignment_exceptions_date_idx
  on public.planner_assignment_exceptions (user_id, semester_id, original_due_date);
create index planner_assignment_urls_order_idx
  on public.planner_assignment_urls (assignment_id, position);
create index planner_assignment_subtasks_order_idx
  on public.planner_assignment_subtasks (assignment_id, position);
create index planner_assignment_subtasks_due_idx
  on public.planner_assignment_subtasks (user_id, due_date)
  where due_date is not null and not is_done;
create index planner_attachment_refs_object_idx
  on public.planner_assignment_attachment_refs (attachment_id);
create index planner_assignment_decks_deck_idx
  on public.planner_assignment_decks (deck_id);
create index planner_assignment_schedules_schedule_idx
  on public.planner_assignment_study_schedules (study_schedule_id);
create index planner_course_notes_calendar_idx
  on public.planner_course_notes (user_id, semester_id, note_date);
create index planner_course_notes_course_idx
  on public.planner_course_notes (planner_course_id, note_date);
create index planner_weekly_focus_week_idx
  on public.planner_weekly_focus_items
  (user_id, semester_id, week_start, position);
create index planner_weekly_focus_assignment_idx
  on public.planner_weekly_focus_items (assignment_id, occurrence_date)
  where assignment_id is not null;
create unique index planner_weekly_focus_pin_once_idx
  on public.planner_weekly_focus_items
  (user_id, semester_id, week_start, assignment_id, occurrence_date)
  nulls not distinct where assignment_id is not null;
create index planner_attachment_cleanup_user_idx
  on public.planner_attachment_cleanup (user_id, queued_at);

-- Every user-facing planner table has an authenticated owner policy. Composite
-- FKs above also bind child rows and external deck/schedule/course links to
-- the same owner (and, where applicable, the same semester).
do $planner_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'planner_semesters', 'planner_courses', 'planner_course_meetings',
    'planner_meeting_exceptions', 'planner_custom_assignment_types',
    'planner_assignments', 'planner_assignment_exceptions',
    'planner_assignment_urls', 'planner_assignment_subtasks',
    'planner_assignment_attachment_refs', 'planner_assignment_decks',
    'planner_assignment_study_schedules', 'planner_course_notes',
    'planner_weekly_focus_items'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format(
      'create policy planner_owner_access on public.%I for all to authenticated
       using (user_id = (select auth.uid()))
       with check (user_id = (select auth.uid()))', table_name
    );
  end loop;
end;
$planner_policies$;

-- Attachments are immutable upload objects. Only the owner can register one,
-- and its origin assignment must exist and belong to the same semester.
alter table public.planner_assignment_attachments enable row level security;
revoke all on table public.planner_assignment_attachments
  from public, anon, authenticated;
grant select, insert on table public.planner_assignment_attachments
  to authenticated;
create policy planner_attachment_select
  on public.planner_assignment_attachments for select to authenticated
  using (user_id = (select auth.uid()));
create policy planner_attachment_insert
  on public.planner_assignment_attachments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.planner_assignments as assignment
      where assignment.id = planner_assignment_attachments.assignment_id
        and assignment.user_id = planner_assignment_attachments.user_id
        and assignment.semester_id = planner_assignment_attachments.semester_id
    )
  );

alter table public.planner_attachment_cleanup enable row level security;
revoke all on table public.planner_attachment_cleanup
  from public, anon, authenticated;
grant select, delete on table public.planner_attachment_cleanup
  to authenticated;
create policy planner_cleanup_select
  on public.planner_attachment_cleanup for select to authenticated
  using (user_id = (select auth.uid()));
create policy planner_cleanup_delete
  on public.planner_attachment_cleanup for delete to authenticated
  using (user_id = (select auth.uid()));

-- Trigger functions run with elevated rights only for metadata cleanup. No
-- client role gets EXECUTE, and no unqualified relation resolves via search_path.
create schema if not exists planner_private;
revoke all on schema planner_private from public, anon, authenticated;

create function planner_private.planner_delete_unreferenced_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lock the object before counting refs so concurrent last-ref deletes cannot
  -- both see the other's uncommitted row and leave an orphaned object.
  perform 1 from public.planner_assignment_attachments as attachment
    where attachment.id = old.attachment_id for update;
  if found and not exists (
    select 1 from public.planner_assignment_attachment_refs as ref
    where ref.attachment_id = old.attachment_id
  ) then
    delete from public.planner_assignment_attachments
    where id = old.attachment_id;
  end if;
  return old;
end;
$$;
revoke all on function planner_private.planner_delete_unreferenced_attachment()
  from public, anon, authenticated;
create trigger planner_delete_unreferenced_attachment
after delete on public.planner_assignment_attachment_refs
for each row execute function planner_private.planner_delete_unreferenced_attachment();

create function planner_private.planner_queue_attachment_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.planner_attachment_cleanup (storage_path, user_id)
  values (old.storage_path, old.user_id)
  on conflict (storage_path) do nothing;
  return old;
end;
$$;
revoke all on function planner_private.planner_queue_attachment_cleanup()
  from public, anon, authenticated;
create trigger planner_queue_attachment_cleanup
after delete on public.planner_assignment_attachments
for each row execute function planner_private.planner_queue_attachment_cleanup();

-- Private bucket. Path: user_id/assignment_id/attachment_uuid/safe-filename.
-- A metadata object and live assignment reference must exist before upload.
insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values (
  'planner-attachments', 'planner-attachments', false, 20971520,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
);

create policy "Planner owners read their attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'planner-attachments'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.planner_assignment_attachments as attachment
    join public.planner_assignment_attachment_refs as ref
      on ref.attachment_id = attachment.id
    where attachment.storage_path = name
      and attachment.user_id = (select auth.uid())
      and ref.user_id = (select auth.uid())
  )
);

-- Supabase Storage remove needs SELECT as well as DELETE. After the final
-- reference is removed, the queue is the authorized cleanup source.
create policy "Planner owners read queued attachments for cleanup"
on storage.objects for select to authenticated
using (
  bucket_id = 'planner-attachments'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.planner_attachment_cleanup as cleanup
    where cleanup.storage_path = name
      and cleanup.user_id = (select auth.uid())
  )
);

create policy "Planner owners upload their attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'planner-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.planner_assignment_attachments as attachment
    join public.planner_assignment_attachment_refs as ref
      on ref.attachment_id = attachment.id
    where attachment.storage_path = name
      and attachment.user_id = (select auth.uid())
      and attachment.assignment_id::text = (storage.foldername(name))[2]
      and attachment.id::text = (storage.foldername(name))[3]
      and ref.user_id = (select auth.uid())
  )
);

-- Once the last metadata ref is gone, the cleanup queue retains the path;
-- deletion remains possible after the origin assignment has been removed.
create policy "Planner owners remove their attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'planner-attachments'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.planner_attachment_cleanup as cleanup
    where cleanup.storage_path = name
      and cleanup.user_id = (select auth.uid())
  )
);

commit;

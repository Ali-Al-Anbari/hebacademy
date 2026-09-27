begin;

-- ==============================================================================
-- Academic Planner — Atomic Attachment Registration RPC
-- ==============================================================================
-- DO NOT RUN OR APPLY DIRECTLY TO LIVE SUPABASE. PENDING USER REVIEW.
-- Provides an atomic transactional registration for attachment metadata
-- and its initial assignment reference, ensuring Storage insert policies
-- are satisfied without leaving orphaned metadata rows.
-- ==============================================================================

create or replace function public.register_planner_assignment_attachment(
  p_assignment_id uuid,
  p_file_name text,
  p_content_type text,
  p_byte_size bigint,
  p_attachment_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
  v_semester_id uuid;
  v_attachment_id uuid;
  v_storage_path text;
  v_safe_filename text;
  v_position integer;
  v_allowed_mime_types text[] := array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ];
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  -- 1. Validate file parameters
  if p_file_name is null or length(btrim(p_file_name)) = 0 then
    raise exception 'File name is required.' using errcode = '22000';
  end if;

  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 20971520 then
    raise exception 'File size must be between 1 byte and 20 MB.' using errcode = '22000';
  end if;

  if p_content_type is null or not (p_content_type = any(v_allowed_mime_types)) then
    raise exception 'Unsupported file type %.', p_content_type using errcode = '22000';
  end if;

  -- Require a supported filename extension as well as an allowed MIME type.
if lower(p_file_name) !~ '\.(pdf|jpg|jpeg|png|webp|doc|docx|ppt|pptx|xls|xlsx|csv)$' then
  raise exception 'Unsupported file extension.' using errcode = '22000';
end if;

-- Ensure the extension agrees with the declared MIME type.
if not (
  (lower(p_file_name) ~ '\.pdf$'
    and p_content_type = 'application/pdf')

  or (lower(p_file_name) ~ '\.(jpg|jpeg)$'
    and p_content_type = 'image/jpeg')

  or (lower(p_file_name) ~ '\.png$'
    and p_content_type = 'image/png')

  or (lower(p_file_name) ~ '\.webp$'
    and p_content_type = 'image/webp')

  or (lower(p_file_name) ~ '\.doc$'
    and p_content_type = 'application/msword')

  or (lower(p_file_name) ~ '\.docx$'
    and p_content_type =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document')

  or (lower(p_file_name) ~ '\.ppt$'
    and p_content_type = 'application/vnd.ms-powerpoint')

  or (lower(p_file_name) ~ '\.pptx$'
    and p_content_type =
      'application/vnd.openxmlformats-officedocument.presentationml.presentation')

  or (lower(p_file_name) ~ '\.xls$'
    and p_content_type = 'application/vnd.ms-excel')

  or (lower(p_file_name) ~ '\.xlsx$'
    and p_content_type =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

  or (lower(p_file_name) ~ '\.csv$'
    and p_content_type = 'text/csv')
) then
  raise exception 'File extension does not match content type.'
    using errcode = '22000';
  end if;

  -- 2. Verify assignment ownership and obtain semester_id
  select semester_id into v_semester_id
  from public.planner_assignments
  where id = p_assignment_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Assignment not found or access denied.' using errcode = 'P0002';
  end if;

  -- 3. Sanitize filename: alphanumeric, dot, underscore, dash; must start with alphanumeric
  -- Matches constraint: split_part(storage_path, '/', 4) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  v_safe_filename := regexp_replace(p_file_name, '[^A-Za-z0-9._-]', '_', 'g');
  if not (v_safe_filename ~ '^[A-Za-z0-9]') then
    v_safe_filename := 'file_' || v_safe_filename;
  end if;

  v_attachment_id := coalesce(p_attachment_id, gen_random_uuid());
  v_storage_path := v_user_id::text || '/' || p_assignment_id::text || '/' || v_attachment_id::text || '/' || v_safe_filename;

  -- 4. Calculate position for reference
  select coalesce(max(position), -1) + 1 into v_position
  from public.planner_assignment_attachment_refs
  where assignment_id = p_assignment_id
    and user_id = v_user_id;

  -- 5. Insert metadata row into planner_assignment_attachments
  insert into public.planner_assignment_attachments (
    id,
    user_id,
    semester_id,
    assignment_id,
    storage_path,
    file_name,
    content_type,
    byte_size,
    created_at
  ) values (
    v_attachment_id,
    v_user_id,
    v_semester_id,
    p_assignment_id,
    v_storage_path,
    p_file_name,
    p_content_type,
    p_byte_size,
    now()
  );

  -- 6. Insert initial reference into planner_assignment_attachment_refs
  insert into public.planner_assignment_attachment_refs (
    user_id,
    semester_id,
    assignment_id,
    attachment_id,
    position
  ) values (
    v_user_id,
    v_semester_id,
    p_assignment_id,
    v_attachment_id,
    v_position
  );

  return jsonb_build_object(
    'id', v_attachment_id,
    'assignment_id', p_assignment_id,
    'semester_id', v_semester_id,
    'storage_path', v_storage_path,
    'file_name', p_file_name,
    'content_type', p_content_type,
    'byte_size', p_byte_size,
    'position', v_position
  );
end;
$$;

grant execute on function public.register_planner_assignment_attachment(uuid, text, text, bigint, uuid) to authenticated;
revoke all on function public.register_planner_assignment_attachment(uuid, text, text, bigint, uuid) from public, anon;

commit;

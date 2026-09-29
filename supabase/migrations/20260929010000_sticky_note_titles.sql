alter table public.user_sticky_notes
  add column title text not null default ''
    check (char_length(title) <= 120);

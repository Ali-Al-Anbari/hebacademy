create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,
  mode text not null check (mode = 'flashcards'),
  started_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index study_sessions_user_started_idx
  on public.study_sessions (user_id, started_at desc);
create index study_sessions_deck_id_idx
  on public.study_sessions (deck_id);

alter table public.study_sessions enable row level security;
revoke all on table public.study_sessions from public, anon, authenticated;
grant select, insert on table public.study_sessions to authenticated;
grant update (completed_at) on table public.study_sessions to authenticated;

create policy "Users can view their own deck sessions"
on public.study_sessions for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id
      and deck.user_id = (select auth.uid())
  )
);

create policy "Users can start sessions in their decks"
on public.study_sessions for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id
      and deck.user_id = (select auth.uid())
  )
);

create policy "Users can complete their own deck sessions"
on public.study_sessions for update to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id
      and deck.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id
      and deck.user_id = (select auth.uid())
  )
);

create table public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  study_session_id uuid not null references public.study_sessions(id) on delete cascade,
  rating text not null check (rating in ('review_again', 'needs_practice', 'mastered')),
  reviewed_at timestamptz not null default now()
);

create index card_reviews_user_reviewed_idx
  on public.card_reviews (user_id, reviewed_at desc);
create index card_reviews_card_reviewed_idx
  on public.card_reviews (card_id, reviewed_at desc);
create index card_reviews_study_session_id_idx
  on public.card_reviews (study_session_id);

alter table public.card_reviews enable row level security;
revoke all on table public.card_reviews from public, anon, authenticated;
grant select, insert on table public.card_reviews to authenticated;

create policy "Users can view reviews from their own deck sessions"
on public.card_reviews for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.cards as card
    join public.study_sessions as session
      on session.id = study_session_id
    where card.id = card_id
      and card.user_id = (select auth.uid())
      and session.user_id = (select auth.uid())
      and card.deck_id = session.deck_id
  )
);

create policy "Users can review cards in their own deck sessions"
on public.card_reviews for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.cards as card
    join public.study_sessions as session
      on session.id = study_session_id
    where card.id = card_id
      and card.user_id = (select auth.uid())
      and session.user_id = (select auth.uid())
      and card.deck_id = session.deck_id
  )
);

-- NULL keeps the existing All Cards behavior for older and new unfiltered sessions.
-- A non-NULL array snapshots the ordered card IDs for a filtered session.
alter table public.study_sessions
  add column selected_card_ids uuid[] null;

alter table public.study_sessions
  add constraint study_sessions_selected_cards_nonempty
  check (selected_card_ids is null or cardinality(selected_card_ids) > 0);

-- The existing insert policy verifies session/deck ownership. This restrictive
-- policy additionally verifies every selected card and rejects repeated IDs.
create policy "Session selection contains only owned deck cards"
on public.study_sessions as restrictive for insert to authenticated
with check (
  selected_card_ids is null
  or (
    cardinality(selected_card_ids) = (
      select count(distinct selected.card_id)
      from unnest(selected_card_ids) as selected(card_id)
    )
    and not exists (
      select 1
      from unnest(selected_card_ids) as selected(card_id)
      where not exists (
        select 1 from public.cards as card
        where card.id = selected.card_id
          and card.deck_id = study_sessions.deck_id
          and card.user_id = (select auth.uid())
      )
    )
  )
);

-- Reviews for filtered sessions must stay within their saved selection, even
-- when a client calls Supabase directly. NULL preserves legacy All Cards sessions.
create policy "Reviews belong to the saved session selection"
on public.card_reviews as restrictive for insert to authenticated
with check (
  exists (
    select 1 from public.study_sessions as session
    where session.id = study_session_id
      and session.user_id = (select auth.uid())
      and (session.selected_card_ids is null or card_id = any(session.selected_card_ids))
  )
);

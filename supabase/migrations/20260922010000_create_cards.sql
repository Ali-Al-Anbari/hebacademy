create table public.cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) > 0),
  answer text not null check (length(btrim(answer)) > 0),
  prompt_image_path text null,
  answer_image_path text null,
  is_starred boolean not null default false,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cards_user_id_idx on public.cards (user_id);
create index cards_deck_id_idx on public.cards (deck_id);
create index cards_deck_id_position_idx on public.cards (deck_id, position);

alter table public.cards enable row level security;
revoke all on table public.cards from public, anon;
grant select, insert, update, delete on table public.cards to authenticated;

create policy "Users can view cards in their decks"
on public.cards for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id and deck.user_id = (select auth.uid())
  )
);

create policy "Users can create cards in their decks"
on public.cards for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id and deck.user_id = (select auth.uid())
  )
);

create policy "Users can update cards in their decks"
on public.cards for update to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id and deck.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id and deck.user_id = (select auth.uid())
  )
);

create policy "Users can delete cards in their decks"
on public.cards for delete to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.decks as deck
    where deck.id = deck_id and deck.user_id = (select auth.uid())
  )
);

-- Private image bucket: maximum 5 MB per image; SVG is intentionally excluded.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images', 'card-images', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

-- Object path: user_id/deck_id/card_id/random-file-name.ext.
create policy "Users can read their card images"
on storage.objects for select to authenticated
using (
  bucket_id = 'card-images'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can upload images to their cards"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'card-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.cards as card
    where card.id::text = (storage.foldername(name))[3]
      and card.deck_id::text = (storage.foldername(name))[2]
      and card.user_id = (select auth.uid())
  )
);

-- Allows cleanup after a card row is deleted. Only the original uploader can remove an object.
create policy "Users can remove their card images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'card-images'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- One database transaction swaps neighboring positions for the move controls.
create function public.move_card(p_card_id uuid, p_direction text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_position integer;
  current_deck_id uuid;
  neighbor_id uuid;
  neighbor_position integer;
begin
  if p_direction is null or p_direction not in ('up', 'down') or auth.uid() is null then
    return false;
  end if;

  select card.position, card.deck_id
    into current_position, current_deck_id
    from public.cards as card
    where card.id = p_card_id and card.user_id = auth.uid()
    for update;
  if not found then return false; end if;

  if p_direction = 'up' then
    select card.id, card.position into neighbor_id, neighbor_position
      from public.cards as card
      where card.deck_id = current_deck_id and card.user_id = auth.uid()
        and card.position < current_position
      order by card.position desc, card.id desc
      limit 1 for update;
  else
    select card.id, card.position into neighbor_id, neighbor_position
      from public.cards as card
      where card.deck_id = current_deck_id and card.user_id = auth.uid()
        and card.position > current_position
      order by card.position asc, card.id asc
      limit 1 for update;
  end if;
  if neighbor_id is null then return false; end if;

  update public.cards
    set position = case
      when id = p_card_id then neighbor_position
      else current_position
    end,
    updated_at = now()
    where id in (p_card_id, neighbor_id) and user_id = auth.uid();
  return true;
end;
$$;

revoke all on function public.move_card(uuid, text) from public, anon;
grant execute on function public.move_card(uuid, text) to authenticated;

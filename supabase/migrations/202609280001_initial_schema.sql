create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  user_id text not null unique check (user_id ~ '^[0-9]{11}$'),
  full_name text not null check (length(btrim(full_name)) between 1 and 80),
  avatar_url text,
  bio text not null default '' check (length(bio) <= 240),
  is_online boolean not null default false,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_full_name_idx on public.profiles (lower(full_name));

create function public.keep_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.keep_profile_updated_at();

create function public.prevent_profile_user_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'User ID cannot be changed';
  end if;
  return new;
end;
$$;

create trigger profiles_user_id_immutable
before update of user_id on public.profiles
for each row execute function public.prevent_profile_user_id_change();

create function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, user_id, full_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'user_id',
    btrim(new.raw_user_meta_data ->> 'full_name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references public.profiles (id) on delete cascade,
  user_two_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_distinct_users check (user_one_id < user_two_id),
  constraint conversations_unique_pair unique (user_one_id, user_two_id)
);

create index conversations_user_one_idx on public.conversations (user_one_id, updated_at desc);
create index conversations_user_two_idx on public.conversations (user_two_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  message_text text not null check (length(btrim(message_text)) between 1 and 4000),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint messages_distinct_users check (sender_id <> receiver_id)
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (receiver_id, conversation_id) where not is_read;

create function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set updated_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_on_message();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

revoke all on public.profiles, public.conversations, public.messages from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, bio) on public.profiles to authenticated;
grant select on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, receiver_id, message_text) on public.messages to authenticated;
grant update (is_read) on public.messages to authenticated;

create policy "Authenticated users can read basic profiles"
on public.profiles for select to authenticated
using (auth.uid() is not null);

create policy "Users can update their own editable profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Participants can read conversations"
on public.conversations for select to authenticated
using (auth.uid() in (user_one_id, user_two_id));

create policy "Participants can read conversation messages"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and auth.uid() in (c.user_one_id, c.user_two_id)
  )
);

create policy "Users can send messages as themselves to their participant"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (
        (c.user_one_id = auth.uid() and c.user_two_id = receiver_id)
        or (c.user_two_id = auth.uid() and c.user_one_id = receiver_id)
      )
  )
);

create policy "Receivers can mark their messages read"
on public.messages for update to authenticated
using (receiver_id = auth.uid())
with check (receiver_id = auth.uid() and is_read);

create function public.search_profiles(search_query text)
returns table (
  id uuid,
  user_id text,
  full_name text,
  avatar_url text,
  bio text,
  is_online boolean,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.user_id, p.full_name, p.avatar_url, p.bio, p.is_online, p.last_seen
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and nullif(btrim(search_query), '') is not null
    and (
      (search_query ~ '^[0-9]{11}$' and p.user_id = search_query)
      or position(lower(btrim(search_query)) in lower(p.full_name)) > 0
    )
  order by p.is_online desc, p.full_name
  limit 15;
$$;

create function public.get_or_create_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  first_user_id uuid;
  second_user_id uuid;
  conversation_id uuid;
begin
  if current_user_id is null or other_user_id = current_user_id then
    raise exception 'Invalid conversation participant';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  first_user_id := least(current_user_id, other_user_id);
  second_user_id := greatest(current_user_id, other_user_id);

  insert into public.conversations (user_one_id, user_two_id)
  values (first_user_id, second_user_id)
  on conflict (user_one_id, user_two_id) do update
    set user_one_id = excluded.user_one_id
  returning id into conversation_id;

  return conversation_id;
end;
$$;

create function public.list_conversations()
returns table (
  id uuid,
  other_id uuid,
  user_id text,
  full_name text,
  avatar_url text,
  bio text,
  is_online boolean,
  last_seen timestamptz,
  latest_message text,
  latest_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    p.id,
    p.user_id,
    p.full_name,
    p.avatar_url,
    p.bio,
    p.is_online,
    p.last_seen,
    latest.message_text,
    latest.created_at,
    (select count(*) from public.messages unread
      where unread.conversation_id = c.id
        and unread.receiver_id = auth.uid()
        and not unread.is_read)
  from public.conversations c
  join public.profiles p on p.id = case
    when c.user_one_id = auth.uid() then c.user_two_id else c.user_one_id end
  left join lateral (
    select m.message_text, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) latest on true
  where auth.uid() is not null
    and auth.uid() in (c.user_one_id, c.user_two_id)
  order by coalesce(latest.created_at, c.created_at) desc
  limit 50;
$$;

create function public.set_presence(online boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  update public.profiles
  set is_online = online, last_seen = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.search_profiles(text) from public;
revoke all on function public.get_or_create_conversation(uuid) from public;
revoke all on function public.list_conversations() from public;
revoke all on function public.set_presence(boolean) from public;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
grant execute on function public.set_presence(boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Signed-in users can view avatars"
on storage.objects for select to authenticated
using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can replace their own avatar"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
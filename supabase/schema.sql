-- Holiday Notes Supabase setup
-- Run this in Supabase Dashboard -> SQL Editor -> New query.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Ich',
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Neue Reise',
  destination text not null default '',
  dates text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.user_friends (
  owner_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  check (owner_id <> friend_id)
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);

alter table public.friend_requests add column if not exists updated_at timestamptz not null default now();

create table if not exists public.global_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'Freizeit',
  created_at timestamptz not null default now()
);

create table if not exists public.trip_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  category text not null default 'Freizeit',
  assignee_id uuid references auth.users(id) on delete set null,
  assignee_name text not null default '',
  packed boolean not null default false,
  missing boolean not null default false,
  shopping boolean not null default false,
  bought boolean not null default false,
  quantity text not null default '',
  note text not null default '',
  item_group text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trip_items add column if not exists bought boolean not null default false;
alter table public.trip_items add column if not exists quantity text not null default '';
alter table public.trip_items add column if not exists note text not null default '';
alter table public.trip_items add column if not exists item_group text not null default '';
alter table public.trips add column if not exists completed boolean not null default false;
alter table public.trips add column if not exists meals jsonb not null default '[]'::jsonb;
alter table public.trips add column if not exists start_date date;
alter table public.trips add column if not exists end_date date;
alter table public.trips add column if not exists travel_method text not null default '';
alter table public.trips add column if not exists activities jsonb not null default '[]'::jsonb;
alter table public.trips add column if not exists smart_context jsonb not null default '{}'::jsonb;
drop function if exists public.join_trip_by_invite(text);
alter table public.trips drop column if exists invite_code;

create table if not exists public.meal_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  ingredients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_trips_updated_at on public.trips;
create trigger touch_trips_updated_at
before update on public.trips
for each row execute function public.touch_updated_at();

drop trigger if exists touch_trip_items_updated_at on public.trip_items;
create trigger touch_trip_items_updated_at
before update on public.trip_items
for each row execute function public.touch_updated_at();

drop trigger if exists touch_meal_templates_updated_at on public.meal_templates;
create trigger touch_meal_templates_updated_at
before update on public.meal_templates
for each row execute function public.touch_updated_at();

create or replace function public.protect_trip_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'Der Besitzer einer Reise kann nicht geändert werden';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_trip_owner on public.trips;
create trigger protect_trip_owner
before update on public.trips
for each row execute function public.protect_trip_owner();

create or replace function public.protect_trip_item_creator()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Der Ersteller eines Eintrags kann nicht geändert werden';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_trip_item_creator on public.trip_items;
create trigger protect_trip_item_creator
before update on public.trip_items
for each row execute function public.protect_trip_item_creator();

create or replace function public.protect_activity_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.actor_id is distinct from old.actor_id then
    raise exception 'Der Ersteller einer Aktivität kann nicht geändert werden';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_activity_actor on public.activity;
create trigger protect_activity_actor
before update on public.activity
for each row execute function public.protect_activity_actor();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'Ich'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.add_owner_as_trip_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (trip_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_trip_created_add_owner on public.trips;
create trigger on_trip_created_add_owner
after insert on public.trips
for each row execute function public.add_owner_as_trip_member();

create or replace function public.is_trip_member(trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_members.trip_id = is_trip_member.trip_id
      and trip_members.user_id = auth.uid()
  );
$$;

create or replace function public.add_friend_by_email(friend_email text)
returns table(friend_id uuid, display_name text, email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_user_id uuid;
begin
  select id into matched_user_id
  from auth.users
  where lower(auth.users.email) = lower(trim(friend_email))
  limit 1;

  if matched_user_id is null then
    raise exception 'Kein Konto mit dieser E-Mail-Adresse gefunden';
  end if;

  if matched_user_id = auth.uid() then
    raise exception 'Du kannst dich nicht selbst als Freund hinzufügen';
  end if;

  insert into public.user_friends (owner_id, friend_id)
  values (auth.uid(), matched_user_id)
  on conflict do nothing;

  return query
  select
    matched_user_id,
    coalesce(p.display_name, split_part(u.email, '@', 1), 'Freund'),
    u.email::text
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = matched_user_id;
end;
$$;

create or replace function public.list_my_friends()
returns table(friend_id uuid, display_name text, email text)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.friend_id,
    coalesce(p.display_name, split_part(u.email, '@', 1), 'Freund'),
    u.email::text
  from public.user_friends f
  join auth.users u on u.id = f.friend_id
  left join public.profiles p on p.id = f.friend_id
  where f.owner_id = auth.uid()
  order by coalesce(p.display_name, u.email);
$$;

create or replace function public.remove_friend(friend_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  with removed_friends as (
    delete from public.user_friends
    where (owner_id = auth.uid() and friend_id = friend_user_id)
       or (owner_id = friend_user_id and friend_id = auth.uid())
  )
  delete from public.friend_requests
  where (requester_id = auth.uid() and recipient_id = friend_user_id)
     or (requester_id = friend_user_id and recipient_id = auth.uid());
$$;

create or replace function public.send_friend_request_by_email(friend_email text)
returns table(friend_id uuid, display_name text, email text, relationship_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_user_id uuid;
  existing_request public.friend_requests;
  response_status text;
begin
  select id into matched_user_id
  from auth.users
  where lower(auth.users.email) = lower(trim(friend_email))
  limit 1;

  if matched_user_id is null then
    raise exception 'Kein Konto mit dieser E-Mail-Adresse gefunden';
  end if;

  if matched_user_id = auth.uid() then
    raise exception 'Du kannst dich nicht selbst als Freund hinzufügen';
  end if;

  if exists (
    select 1 from public.user_friends as uf
    where uf.owner_id = auth.uid() and uf.friend_id = matched_user_id
  ) then
    response_status := 'accepted';
  else
    select * into existing_request
    from public.friend_requests
    where (requester_id = auth.uid() and recipient_id = matched_user_id)
       or (requester_id = matched_user_id and recipient_id = auth.uid())
    order by updated_at desc
    limit 1;

    if found and existing_request.status = 'pending' then
      response_status := case when existing_request.recipient_id = auth.uid() then 'incoming' else 'pending' end;
    elsif found then
      update public.friend_requests
      set requester_id = auth.uid(), recipient_id = matched_user_id, status = 'pending', updated_at = now()
      where id = existing_request.id;
      response_status := 'pending';
    else
      insert into public.friend_requests (requester_id, recipient_id)
      values (auth.uid(), matched_user_id);
      response_status := 'pending';
    end if;
  end if;

  return query
  select
    matched_user_id,
    coalesce(p.display_name, split_part(u.email, '@', 1), 'Freund'),
    u.email::text,
    response_status::text
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = matched_user_id;
end;
$$;

create or replace function public.list_my_friend_requests()
returns table(request_id uuid, direction text, display_name text, email text)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    (case when r.recipient_id = auth.uid() then 'incoming' else 'outgoing' end)::text,
    coalesce(p.display_name, split_part(u.email, '@', 1), 'Freund'),
    u.email::text
  from public.friend_requests r
  join auth.users u on u.id = case when r.recipient_id = auth.uid() then r.requester_id else r.recipient_id end
  left join public.profiles p on p.id = u.id
  where (r.requester_id = auth.uid() or r.recipient_id = auth.uid())
    and r.status = 'pending'
  order by r.created_at desc;
$$;

create or replace function public.respond_to_friend_request(target_request_id uuid, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid;
begin
  select requester_id into requester
  from public.friend_requests
  where id = target_request_id
    and recipient_id = auth.uid()
    and status = 'pending';

  if requester is null then
    raise exception 'Freundschaftsanfrage wurde nicht gefunden';
  end if;

  update public.friend_requests
  set status = case when accept_request then 'accepted' else 'rejected' end,
      updated_at = now()
  where id = target_request_id;

  if accept_request then
    insert into public.user_friends (owner_id, friend_id)
    values (auth.uid(), requester), (requester, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.sync_trip_friends(target_trip_id uuid, friend_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.trips
    where id = target_trip_id and owner_id = auth.uid()
  ) then
    raise exception 'Nur der Besitzer darf Reisefreunde verwalten';
  end if;

  delete from public.trip_members
  where trip_id = target_trip_id and role = 'member';

  insert into public.trip_members (trip_id, user_id, role)
  select target_trip_id, friend_id, 'member'
  from public.user_friends
  where owner_id = auth.uid()
    and friend_id = any(coalesce(friend_user_ids, array[]::uuid[]))
  on conflict (trip_id, user_id) do update set role = 'member';
end;
$$;

create or replace function public.delete_current_user(confirm_text text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Du bist nicht angemeldet';
  end if;

  if confirm_text <> 'KONTO LÖSCHEN' then
    raise exception 'Bestätigung für Kontolöschung fehlt';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.add_friend_by_email(text) from public;
revoke all on function public.list_my_friends() from public;
revoke all on function public.remove_friend(uuid) from public;
revoke all on function public.sync_trip_friends(uuid, uuid[]) from public;
revoke all on function public.delete_current_user(text) from public;
grant execute on function public.add_friend_by_email(text) to authenticated;
grant execute on function public.list_my_friends() to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.sync_trip_friends(uuid, uuid[]) to authenticated;
grant execute on function public.delete_current_user(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.user_friends enable row level security;
alter table public.global_items enable row level security;
alter table public.trip_items enable row level security;
alter table public.activity enable row level security;
alter table public.meal_templates enable row level security;

drop policy if exists "profiles are visible to authenticated users" on public.profiles;
create policy "profiles are visible to authenticated users"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "members can read trips" on public.trips;
create policy "members can read trips"
on public.trips for select
to authenticated
using (public.is_trip_member(id));

drop policy if exists "users can create own trips" on public.trips;
create policy "users can create own trips"
on public.trips for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "members can update trips" on public.trips;
create policy "members can update trips"
on public.trips for update
to authenticated
using (public.is_trip_member(id))
with check (public.is_trip_member(id));

drop policy if exists "owners can delete trips" on public.trips;
create policy "owners can delete trips"
on public.trips for delete
to authenticated
using (owner_id = auth.uid());

drop policy if exists "members can read trip members" on public.trip_members;
create policy "members can read trip members"
on public.trip_members for select
to authenticated
using (public.is_trip_member(trip_id));

drop policy if exists "owners can add trip members" on public.trip_members;
create policy "owners can add trip members"
on public.trip_members for insert
to authenticated
with check (
  exists (
    select 1 from public.trip_members owner_row
    where owner_row.trip_id = trip_members.trip_id
      and owner_row.user_id = auth.uid()
      and owner_row.role = 'owner'
  )
);

drop policy if exists "members can leave trips" on public.trip_members;
create policy "members can leave trips"
on public.trip_members for delete
to authenticated
using (user_id = auth.uid() and role = 'member');

drop policy if exists "users read own friends" on public.user_friends;
create policy "users read own friends"
on public.user_friends for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists "users manage own friends" on public.user_friends;
create policy "users manage own friends"
on public.user_friends for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "users manage own global items" on public.global_items;
create policy "users manage own global items"
on public.global_items for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "users manage own meal templates" on public.meal_templates;
create policy "users manage own meal templates"
on public.meal_templates for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "members can read trip items" on public.trip_items;
create policy "members can read trip items"
on public.trip_items for select
to authenticated
using (public.is_trip_member(trip_id));

drop policy if exists "members can create trip items" on public.trip_items;
create policy "members can create trip items"
on public.trip_items for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists "members can update trip items" on public.trip_items;
create policy "members can update trip items"
on public.trip_items for update
to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id));

drop policy if exists "members can delete trip items" on public.trip_items;
create policy "members can delete trip items"
on public.trip_items for delete
to authenticated
using (public.is_trip_member(trip_id));

drop policy if exists "members can read activity" on public.activity;
create policy "members can read activity"
on public.activity for select
to authenticated
using (public.is_trip_member(trip_id));

drop policy if exists "members can create activity" on public.activity;
create policy "members can create activity"
on public.activity for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and (actor_id is null or actor_id = auth.uid())
);

drop policy if exists "members can update activity" on public.activity;
create policy "members can update activity"
on public.activity for update
to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id));

drop policy if exists "members can delete activity" on public.activity;
create policy "members can delete activity"
on public.activity for delete
to authenticated
using (public.is_trip_member(trip_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips') then
    alter publication supabase_realtime add table public.trips;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_members') then
    alter publication supabase_realtime add table public.trip_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'global_items') then
    alter publication supabase_realtime add table public.global_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_items') then
    alter publication supabase_realtime add table public.trip_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity') then
    alter publication supabase_realtime add table public.activity;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meal_templates') then
    alter publication supabase_realtime add table public.meal_templates;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_friends') then
    alter publication supabase_realtime add table public.user_friends;
  end if;
end $$;

-- Bestehende, frühere Freundschaften bleiben gültig und werden gegenseitig ergänzt.
insert into public.user_friends (owner_id, friend_id)
select friend_id, owner_id
from public.user_friends
on conflict do nothing;

alter table public.friend_requests enable row level security;

revoke all on function public.add_friend_by_email(text) from authenticated;
revoke all on function public.send_friend_request_by_email(text) from public;
revoke all on function public.list_my_friend_requests() from public;
revoke all on function public.respond_to_friend_request(uuid, boolean) from public;
grant execute on function public.send_friend_request_by_email(text) to authenticated;
grant execute on function public.list_my_friend_requests() to authenticated;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

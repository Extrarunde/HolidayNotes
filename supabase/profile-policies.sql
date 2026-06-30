alter table public.profiles enable row level security;

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

alter table public.user_friends enable row level security;

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

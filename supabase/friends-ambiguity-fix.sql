-- Holiday Notes: Reparatur fuer "column reference friend_id is ambiguous".
-- Im Supabase Dashboard unter SQL Editor einfuegen und einmal ausfuehren.
-- Der Fix kann gefahrlos erneut ausgefuehrt werden und aendert keine Freundschaften.

create or replace function public.list_my_friends()
returns table(friend_id uuid, display_name text, email text)
language sql
security definer
set search_path = public
stable
as $$
  select
    uf.friend_id,
    coalesce(p.display_name, split_part(u.email, '@', 1), 'Freund'),
    u.email
  from public.user_friends as uf
  join auth.users as u on u.id = uf.friend_id
  left join public.profiles as p on p.id = uf.friend_id
  where uf.owner_id = auth.uid()
  order by coalesce(p.display_name, u.email);
$$;

create or replace function public.sync_trip_friends(target_trip_id uuid, friend_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.trips as t
    where t.id = target_trip_id
      and t.owner_id = auth.uid()
  ) then
    raise exception 'Nur der Besitzer darf Reisefreunde verwalten';
  end if;

  delete from public.trip_members as tm
  where tm.trip_id = target_trip_id
    and tm.role = 'member';

  insert into public.trip_members (trip_id, user_id, role)
  select target_trip_id, uf.friend_id, 'member'
  from public.user_friends as uf
  where uf.owner_id = auth.uid()
    and uf.friend_id = any(coalesce(friend_user_ids, array[]::uuid[]))
  on conflict (trip_id, user_id) do update set role = 'member';
end;
$$;

revoke all on function public.list_my_friends() from public;
revoke all on function public.sync_trip_friends(uuid, uuid[]) from public;
grant execute on function public.list_my_friends() to authenticated;
grant execute on function public.sync_trip_friends(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';

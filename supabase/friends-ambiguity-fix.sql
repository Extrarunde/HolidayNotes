-- Holiday Notes: Reparatur fuer "column reference friend_id is ambiguous".
-- Im Supabase Dashboard unter SQL Editor einfuegen und einmal ausfuehren.
-- Der Fix kann gefahrlos erneut ausgefuehrt werden und aendert keine Freundschaften.

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
  select u.id into matched_user_id
  from auth.users as u
  where lower(u.email) = lower(trim(friend_email))
  limit 1;

  if matched_user_id is null then
    raise exception 'Kein Konto mit dieser E-Mail-Adresse gefunden';
  end if;

  if matched_user_id = auth.uid() then
    raise exception 'Du kannst dich nicht selbst als Freund hinzufuegen';
  end if;

  if exists (
    select 1
    from public.user_friends as uf
    where uf.owner_id = auth.uid()
      and uf.friend_id = matched_user_id
  ) then
    response_status := 'accepted';
  else
    select fr.* into existing_request
    from public.friend_requests as fr
    where (fr.requester_id = auth.uid() and fr.recipient_id = matched_user_id)
       or (fr.requester_id = matched_user_id and fr.recipient_id = auth.uid())
    order by fr.updated_at desc
    limit 1;

    if found and existing_request.status = 'pending' then
      response_status := case when existing_request.recipient_id = auth.uid() then 'incoming' else 'pending' end;
    elsif found then
      update public.friend_requests as fr
      set requester_id = auth.uid(),
          recipient_id = matched_user_id,
          status = 'pending',
          updated_at = now()
      where fr.id = existing_request.id;
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
  from auth.users as u
  left join public.profiles as p on p.id = u.id
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
    uf.friend_id,
    coalesce(p.display_name, split_part(u.email, '@', 1), 'Freund'),
    u.email::text
  from public.user_friends as uf
  join auth.users as u on u.id = uf.friend_id
  left join public.profiles as p on p.id = uf.friend_id
  where uf.owner_id = auth.uid()
  order by coalesce(p.display_name, u.email);
$$;

create or replace function public.list_my_friend_requests()
returns table(request_id uuid, direction text, display_name text, email text)
language sql
security definer
set search_path = public
stable
as $$
  select
    fr.id,
    (case when fr.recipient_id = auth.uid() then 'incoming' else 'outgoing' end)::text,
    coalesce(p.display_name, split_part(u.email, '@', 1), 'Freund'),
    u.email::text
  from public.friend_requests as fr
  join auth.users as u on u.id = case when fr.recipient_id = auth.uid() then fr.requester_id else fr.recipient_id end
  left join public.profiles as p on p.id = u.id
  where (fr.requester_id = auth.uid() or fr.recipient_id = auth.uid())
    and fr.status = 'pending'
  order by fr.created_at desc;
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
revoke all on function public.list_my_friend_requests() from public;
revoke all on function public.sync_trip_friends(uuid, uuid[]) from public;
revoke all on function public.send_friend_request_by_email(text) from public;
grant execute on function public.list_my_friends() to authenticated;
grant execute on function public.list_my_friend_requests() to authenticated;
grant execute on function public.sync_trip_friends(uuid, uuid[]) to authenticated;
grant execute on function public.send_friend_request_by_email(text) to authenticated;

notify pgrst, 'reload schema';

-- Einmal im Supabase Dashboard unter SQL Editor ausfuehren.
-- Repariert die Freundschaftsanfrage-Funktion fuer bestehende Projekte.

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
    select 1
    from public.user_friends as uf
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
    u.email,
    response_status
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = matched_user_id;
end;
$$;

revoke all on function public.send_friend_request_by_email(text) from public;
grant execute on function public.send_friend_request_by_email(text) to authenticated;

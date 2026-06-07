-- ============================================
-- Friend invite link (migration 046)
-- ============================================
-- Opening someone's invite link (while logged in) makes you friends
-- instantly. RLS only lets the addressee accept a request, so this runs as
-- a SECURITY DEFINER function: it creates an already-accepted friendship
-- between the inviter and the opener (auth.uid()), or accepts a pending one
-- if it already exists. No-ops on self / unknown inviter / existing
-- friendship.

create or replace function accept_friend_invite(p_inviter uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_inviter is null or p_inviter = v_me then
    return;
  end if;

  -- The inviter must be a real account.
  if not exists (select 1 from profiles where id = p_inviter) then
    return;
  end if;

  -- Already related in either direction? Accept a pending request; otherwise
  -- they're already friends — nothing to do.
  if exists (
    select 1 from friendships
    where (requester_id = v_me and addressee_id = p_inviter)
       or (requester_id = p_inviter and addressee_id = v_me)
  ) then
    update friendships
      set status = 'accepted'
    where status = 'pending'
      and ((requester_id = v_me and addressee_id = p_inviter)
        or (requester_id = p_inviter and addressee_id = v_me));
    return;
  end if;

  -- New instant friendship (inviter as requester, opener as addressee).
  insert into friendships (requester_id, addressee_id, status)
  values (p_inviter, v_me, 'accepted');
end;
$$;

grant execute on function accept_friend_invite(uuid) to authenticated;

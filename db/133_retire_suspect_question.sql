-- 133: retire "Who do you suspect?"
--
-- Suspicion alone doesn't do much in play, so the question is gone from the
-- picker and bots no longer ask it: their questions are now "Which side are
-- you on?" and "Which role are you?" (each once per player per day, as in
-- 132). A bot still answers "Who do you suspect?" if a not-yet-refreshed
-- client sends it, and old messages still render.
--
-- Requires 132. Safe to re-run.

begin;

-- A question it hasn't asked this player today (random), or null once it has
-- asked both. ("Who do you suspect?" retired in 133.)
create or replace function vv_bot_next_question(p_bot uuid, p_other uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_asked jsonb; v_day int; v_q text;
begin
  select coalesce(s.bot_memory->'asked', '{}'::jsonb), r.day into v_asked, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce((v_asked->>'day')::int, -1) <> v_day then v_asked := '{}'::jsonb; end if;
  select q into v_q from unnest(array['ask_side', 'ask_role']) q
   where not (coalesce(v_asked->p_other::text, '[]'::jsonb) ? q)
   order by random() limit 1;
  return v_q;
end;
$$;
revoke all on function vv_bot_next_question(uuid, uuid) from public, anon, authenticated;

-- Open a conversation. Same partner choice as 131 (an ally if it has one;
-- anyone when inked). With something to share it shares — or deceives — about
-- 60% of the time ("Let's vote … out." now stands in for "I suspect …");
-- otherwise, and whenever it knows nothing, it opens with a question (side
-- or role — "Who do you suspect?" is retired since 133).
create or replace function vv_bot_initiate(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_mycamp text; v_bluff numeric; v_known jsonb; v_sus jsonb;
  v_partner uuid; v_ally boolean; v_t uuid; v_tcamp text; v_lie boolean;
  v_key text; v_about uuid; v_res jsonb;
  v_ink boolean := vv_bot_tormented(p_bot);   -- inked: can't pick by who (131)
begin
  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_mycamp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  v_known := vv_bot_known(p_bot);

  select p.id into v_partner
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and not v_ink
     and ((v_known->>p.id::text) = v_mycamp
          or coalesce((v_sus->>p.id::text)::numeric, 0) < 0)
   order by random() limit 1;
  if v_partner is null then
    select p.id into v_partner
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not v_ink
       and (v_known->>p.id::text) is distinct from case when v_mycamp = 'vice' then 'virtue' else 'vice' end
     order by random() limit 1;
  end if;
  if v_partner is null then
    select p.id into v_partner
      from players p where p.room_id = v_room and p.id <> p_bot and not p.dead
     order by random() limit 1;
  end if;
  if v_partner is null then return; end if;

  v_ally := not v_ink and coalesce((v_known->>v_partner::text) = v_mycamp
            or coalesce((v_sus->>v_partner::text)::numeric, 0) < 0, false);
  v_lie := not v_ally and random() < case when v_mycamp = 'vice'
                                          then least(0.9, v_bluff + 0.35)
                                          else v_bluff end;

  v_t := vv_bot_target(p_bot, false);
  if v_t = v_partner then v_t := null; end if;
  v_tcamp := v_known->>v_t::text;

  if v_t is not null and random() < 0.6 then
    if not v_lie then
      -- What it actually knows (or suspects).
      if v_tcamp in ('vice', 'virtue') then
        v_key := 'claim_' || v_tcamp; v_about := v_t;
      else
        v_key := 'vote'; v_about := v_t;
      end if;
    elsif v_mycamp = 'vice' and v_tcamp = 'virtue' then
      v_key := 'claim_vice'; v_about := v_t;   -- frame a known Virtue
    elsif v_mycamp = 'vice' then
      v_key := 'self_virtue';
    else
      -- A Virtue's bluff: point at someone it has no case against.
      select p.id into v_about
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, v_partner, v_t)
       order by random() limit 1;
      if v_about is not null then
        v_key := 'vote';
      else
        v_key := coalesce(vv_bot_next_question(p_bot, v_partner), 'ask_side');
      end if;
    end if;
  else
    -- Nothing it wants to share right now: ask.
    v_key := coalesce(vv_bot_next_question(p_bot, v_partner), 'ask_side');
  end if;

  v_res := vv_send_sentence(p_bot, v_partner, v_key, v_about);
  if coalesce((v_res->>'ok')::boolean, false)
     and v_key in ('ask_side', 'ask_role') then
    perform vv_bot_mark_asked(p_bot, v_partner, v_key);
  end if;
end;
$$;
revoke all on function vv_bot_initiate(uuid) from public, anon, authenticated;

commit;

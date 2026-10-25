-- 132: Outreach — "Which role are you?", and curious bots
--
-- * New premade question "Which role are you?" and answer "I'm the <role>."
--   (any role — it can be a bluff). The answer counts as a claim about the
--   sender's CAMP, so bots weigh, remember and verify it like "I'm a Virtue."
-- * "I suspect …" is retired from the picker and from bots ("Let's vote … out."
--   covers it); it still renders in old messages.
-- * Bots are more inquisitive: after answering a question or reacting to a
--   claim they usually ask one of their own (side / role / suspect — each at
--   most once per player per day, and never what that player already
--   volunteered), they open conversations with questions more often, and they
--   only wind down ("Thanks." / "Talk tomorrow.") once they've asked it all.
--   The 12-answers-a-day cap still ends every conversation.
--
-- send_dm_sentence / vv_send_sentence gain p_role (the 4-argument versions are
-- dropped, so update the client after running this). vv_bot_reply gains
-- p_last. Requires 128, 129, 130 and 131. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Sentence text: + "Which role are you?" and "I'm the <role>." (the role's
-- display name comes in p_about_name). 'suspect' stays renderable for old
-- messages but is no longer offered or used by bots.
create or replace function vv_sentence_text(p_key text, p_about_name text)
returns text language sql immutable as $$
  select case p_key
    when 'claim_vice'   then coalesce(p_about_name, 'Someone') || ' is a Vice.'
    when 'claim_virtue' then coalesce(p_about_name, 'Someone') || ' is a Virtue.'
    when 'self_virtue'  then 'I''m a Virtue.'
    when 'self_vice'    then 'I''m a Vice.'
    when 'self_role'    then 'I''m the ' || coalesce(p_about_name, '…') || '.'
    when 'suspect'      then 'I suspect ' || coalesce(p_about_name, 'someone') || '.'
    when 'trust'        then 'I trust ' || coalesce(p_about_name, 'someone') || '.'
    when 'vote'         then 'Let''s vote ' || coalesce(p_about_name, 'someone') || ' out.'
    when 'ask_suspect'  then 'Who do you suspect?'
    when 'ask_side'     then 'Which side are you on?'
    when 'ask_role'     then 'Which role are you?'
    when 'believe'      then 'I believe you.'
    when 'disbelieve'   then 'I don''t believe you.'
    when 'check'        then 'I''ll check that.'
    when 'no_idea'      then 'No idea yet.'
    when 'thanks'       then 'Thanks.'
    when 'bye'          then 'Talk tomorrow.'
    else null end;
$$;

-- ---------------------------------------------------------------------------
-- Sending gains a role (for "I'm the <role>."). The old 4-argument versions
-- are DROPPED rather than overloaded: next to a 5-argument version with a
-- default, every 4-argument call would be ambiguous. Existing callers keep
-- working — they resolve to the new function and its default.
drop function if exists send_dm_sentence(uuid, uuid, text, uuid);
drop function if exists vv_send_sentence(uuid, uuid, text, uuid);

create or replace function vv_send_sentence(
  p_sender uuid, p_recipient uuid, p_key text, p_about uuid default null, p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_dead boolean; v_rec_room uuid; v_comms boolean; v_existing uuid;
  v_role text; v_muted boolean; v_muted_day int; v_day int; v_phase text;
  v_about_name text; v_text text;
begin
  select p.room_id, p.dead, coalesce(s.potion_comms, false), s.role,
         p.muted, p.ability_muted_day, r.day, r.phase
    into v_room, v_dead, v_comms, v_role, v_muted, v_muted_day, v_day, v_phase
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_sender;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'outreach' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead then return jsonb_build_object('ok', false, 'reason', 'cannot_chat'); end if;
  if p_recipient is null or p_recipient = p_sender then
    return jsonb_build_object('ok', false, 'reason', 'bad_recipient');
  end if;
  select room_id into v_rec_room from players where id = p_recipient;
  if v_rec_room is distinct from v_room then
    return jsonb_build_object('ok', false, 'reason', 'bad_recipient');
  end if;
  if coalesce(v_muted, false) or v_muted_day is not distinct from v_day then
    return jsonb_build_object('ok', false, 'reason', 'muted');
  end if;

  if vv_sentence_text(p_key, null) is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_sentence');
  end if;
  if vv_sentence_needs_about(p_key) then
    if p_about is null or p_about = p_sender then
      return jsonb_build_object('ok', false, 'reason', 'bad_about');
    end if;
    select name into v_about_name from players where id = p_about and room_id = v_room;
    if v_about_name is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_about');
    end if;
  end if;
  -- A role claim names a real role (any camp — it may be a bluff).
  if p_key = 'self_role' then
    if p_role is null or vv_role_camp(p_role) is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_role');
    end if;
    v_about_name := initcap(replace(p_role, '_', ' '));
  end if;

  -- One partner per cycle (same rule and exemptions as send_dm).
  if not v_comms and v_role is distinct from 'sociability' then
    select recipient_id into v_existing
      from dm_messages
     where room_id = v_room and sender_id = p_sender and day = v_day
     order by created_at
     limit 1;
    if v_existing is not null and v_existing is distinct from p_recipient then
      return jsonb_build_object('ok', false, 'reason', 'partner_locked');
    end if;
  end if;

  v_text := vv_sentence_text(p_key, v_about_name);
  -- clock_timestamp, not the default now(): a bot's answer and its follow-up
  -- question are sent in one transaction and must keep their order.
  insert into dm_messages (room_id, sender_id, recipient_id, day, text, payload, created_at)
  values (v_room, p_sender, p_recipient, v_day, v_text,
          jsonb_build_object('s', p_key,
                             'about', case when vv_sentence_needs_about(p_key)
                                           then p_about::text end,
                             'role', case when p_key = 'self_role' then p_role end),
          clock_timestamp());
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function vv_send_sentence(uuid, uuid, text, uuid, text) from public, anon, authenticated;

create or replace function send_dm_sentence(
  p_sender_id uuid, p_recipient_id uuid, p_sentence text,
  p_about uuid default null, p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_sender_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return vv_send_sentence(p_sender_id, p_recipient_id, p_sentence, p_about, p_role);
end;
$$;
grant execute on function send_dm_sentence(uuid, uuid, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A role a bot can CLAIM in the given camp: one in this game's cast other than
-- its own, else a sensible default — never null.
create or replace function vv_bot_role_bluff(p_bot uuid, p_camp text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_my text; v_pool jsonb; v_pick text;
begin
  select s.role, r.role_pool into v_my, v_pool
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if jsonb_typeof(v_pool) = 'array' then
    select x into v_pick from jsonb_array_elements_text(v_pool) x
     where vv_role_camp(x) = p_camp and x is distinct from v_my
     order by random() limit 1;
  end if;
  if v_pick is null then
    select x into v_pick
      from unnest(case when p_camp = 'vice'
                       then array['murder', 'intoxication', 'envy', 'torment', 'vengeance']
                       else array['justice', 'empathy', 'certainty', 'truthfulness', 'sacrifice'] end) x
     where x is distinct from v_my
     order by random() limit 1;
  end if;
  return v_pick;
end;
$$;
revoke all on function vv_bot_role_bluff(uuid, text) from public, anon, authenticated;

-- What a bot won't ask a player again today: the questions it already asked
-- them, and whatever they volunteered ("I'm a Virtue." covers "Which side are
-- you on?"). bot_memory.asked = {day, <player id>: [question keys]}.
create or replace function vv_bot_mark_asked(p_bot uuid, p_other uuid, p_q text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_asked jsonb; v_day int; v_list jsonb;
begin
  select coalesce(s.bot_memory->'asked', '{}'::jsonb), r.day into v_asked, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce((v_asked->>'day')::int, -1) <> v_day then
    v_asked := jsonb_build_object('day', v_day);
  end if;
  v_list := coalesce(v_asked->p_other::text, '[]'::jsonb);
  if v_list ? p_q then return; end if;
  perform vv_bot_set(p_bot, 'asked',
    v_asked || jsonb_build_object(p_other::text, v_list || jsonb_build_array(p_q)));
end;
$$;
revoke all on function vv_bot_mark_asked(uuid, uuid, text) from public, anon, authenticated;

-- A question it hasn't asked this player today (random), or null once it has
-- asked all three.
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
  select q into v_q from unnest(array['ask_side', 'ask_role', 'ask_suspect']) q
   where not (coalesce(v_asked->p_other::text, '[]'::jsonb) ? q)
   order by random() limit 1;
  return v_q;
end;
$$;
revoke all on function vv_bot_next_question(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Answer one message — and stay curious. Every message is answered except
-- "Talk tomorrow."; after answering a question or reacting to a claim it often
-- asks one of its own (side / role / suspect — each at most once per player
-- per day), and it only winds down with "Thanks." / "Talk tomorrow." once it
-- has nothing left to ask. What it SAYS can be a bluff.
-- p_last = false: more of this player's messages are waiting in the same
-- batch, so it answers without tacking on a question of its own.
drop function if exists vv_bot_reply(uuid, uuid, jsonb, text);

create or replace function vv_bot_reply(
  p_bot uuid, p_sender uuid, p_payload jsonb, p_outcome text, p_last boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_about uuid;
  v_style text; v_bluff numeric; v_mycamp text; v_myrole text; v_known jsonb; v_room uuid;
  v_reply text; v_reply_about uuid; v_reply_role text;
  v_t uuid; v_tcamp text; v_honest boolean; v_ally boolean;
  v_next text; v_follow boolean := false; v_res jsonb;
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  v_style := vv_bot_persona(p_bot)->>'style';
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  select vv_role_camp(s.role), s.role, p.room_id into v_mycamp, v_myrole, v_room
    from player_secrets s join players p on p.id = s.player_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);
  v_honest := random() >= v_bluff;
  v_ally := coalesce((v_known->>p_sender::text) = v_mycamp and not vv_bot_tormented(p_bot), false);

  -- What they just volunteered needn't be asked.
  if v_key in ('self_vice', 'self_virtue', 'self_role') then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_side');
  end if;
  if v_key = 'self_role' then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_role');
  end if;
  v_next := vv_bot_next_question(p_bot, p_sender);

  if v_key = 'bye' then
    return;                                   -- the conversation is over
  elsif v_key = 'thanks' then
    v_reply := case when v_next is not null and random() < 0.5 then v_next else 'bye' end;
  elsif v_key in ('believe', 'disbelieve', 'check', 'no_idea') then
    -- Keep it going while it still has something to ask.
    if v_next is not null and random() < 0.8 then
      v_reply := v_next;
    else
      v_reply := case when random() < 0.6 then 'thanks' else 'bye' end;
    end if;

  elsif v_key = 'ask_side' then
    -- To a known ally: the truth. Otherwise a Vice nearly always claims
    -- Virtue, and a Virtue tells the truth unless it's bluffing.
    if v_ally then
      v_reply := case when v_mycamp = 'vice' then 'self_vice' else 'self_virtue' end;
    elsif v_mycamp = 'vice' then
      v_reply := case when random() < 0.9 then 'self_virtue' else 'self_vice' end;
    else
      v_reply := case when v_honest then 'self_virtue' else 'self_vice' end;
    end if;
    v_follow := true;

  elsif v_key = 'ask_role' then
    -- Same idea: the truth to an ally; a Vice nearly always names a Virtue
    -- role; a bluffing Virtue names another Virtue role (to shield its own).
    if v_ally then
      v_reply_role := v_myrole;
    elsif v_mycamp = 'vice' then
      v_reply_role := case when random() < 0.9 then vv_bot_role_bluff(p_bot, 'virtue') else v_myrole end;
    elsif v_honest then
      v_reply_role := v_myrole;
    else
      v_reply_role := vv_bot_role_bluff(p_bot, 'virtue');
    end if;
    v_reply := 'self_role';
    v_follow := true;

  elsif v_key = 'ask_suspect' then
    if v_honest then
      v_t := vv_bot_target(p_bot, false);
      if v_t is not null and v_t <> p_sender then
        v_tcamp := v_known->>v_t::text;
        -- Names a camp outright only when that helps its side.
        v_reply := case when v_tcamp in ('vice', 'virtue') and (v_ally or v_mycamp = 'virtue')
                        then 'claim_' || v_tcamp else 'vote' end;
        v_reply_about := v_t;
      else
        v_reply := 'no_idea';
      end if;
    else
      select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender);
      if v_t is not null then v_reply := 'vote'; v_reply_about := v_t;
      else v_reply := 'no_idea'; end if;
    end if;
    v_follow := true;

  elsif v_key in ('suspect', 'vote') and v_about = p_bot then
    -- Accused: defend itself (a Vice lies about its camp).
    v_reply := case when v_mycamp = 'vice' and random() < 0.9 then 'self_virtue'
                    when v_mycamp = 'vice' then 'disbelieve'
                    else 'self_virtue' end;
    v_follow := true;
  elsif v_key = 'trust' and v_about = p_bot then
    v_reply := 'thanks';
    v_follow := true;

  elsif p_outcome in ('known_true', 'believed') then
    v_reply := case when p_outcome = 'believed' and v_style <> 'trusting' and random() < 0.3
                    then 'check' else 'believe' end;
    v_follow := true;
  elsif p_outcome in ('known_false', 'doubted') then
    if random() < v_bluff then
      v_reply := 'believe';                   -- keep its doubts to itself
    elsif p_outcome = 'known_false' then
      v_reply := 'disbelieve';
    else
      v_reply := case when v_style = 'skeptical' and random() < 0.5 then 'check'
                      when random() < 0.6 then 'disbelieve' else 'check' end;
    end if;
    v_follow := true;
  else
    v_reply := 'no_idea';                     -- never leave it unanswered
  end if;

  v_res := vv_send_sentence(p_bot, p_sender, v_reply, v_reply_about, v_reply_role);
  if not coalesce((v_res->>'ok')::boolean, false) then return; end if;
  if v_reply in ('ask_side', 'ask_role', 'ask_suspect') then
    perform vv_bot_mark_asked(p_bot, p_sender, v_reply);
    return;
  end if;

  -- Curious: follow its answer with a question of its own.
  if v_follow and p_last and v_next is not null and random() < 0.65 then
    v_res := vv_send_sentence(p_bot, p_sender, v_next);
    if coalesce((v_res->>'ok')::boolean, false) then
      perform vv_bot_mark_asked(p_bot, p_sender, v_next);
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_reply(uuid, uuid, jsonb, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Open a conversation. Same partner choice as 131 (an ally if it has one;
-- anyone when inked). With something to share it shares — or deceives — about
-- 60% of the time ("Let's vote … out." now stands in for "I suspect …");
-- otherwise, and whenever it knows nothing, it opens with a question.
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
      v_key := case when v_about is not null then 'vote' else 'ask_suspect' end;
    end if;
  else
    -- Nothing it wants to share right now: ask.
    v_key := coalesce(vv_bot_next_question(p_bot, v_partner), 'ask_suspect');
  end if;

  v_res := vv_send_sentence(p_bot, v_partner, v_key, v_about);
  if coalesce((v_res->>'ok')::boolean, false)
     and v_key in ('ask_side', 'ask_role', 'ask_suspect') then
    perform vv_bot_mark_asked(p_bot, v_partner, v_key);
  end if;
end;
$$;
revoke all on function vv_bot_initiate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hearing (131's) + the role question and role claims.
create or replace function vv_bot_hear(p_bot uuid, p_sender uuid, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_about uuid;
  v_subj uuid; v_camp text; v_truth text; v_mycamp text; v_day integer;
  v_known jsonb; v_believed boolean; v_delta numeric; v_mem jsonb;
  v_ink boolean := vv_bot_tormented(p_bot);   -- can't see who's talking (131)
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  select vv_role_camp(s.role), r.day, s.bot_memory into v_mycamp, v_day, v_mem
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);

  if v_key in ('ask_suspect', 'ask_side', 'ask_role') then return 'question'; end if;
  -- Inked: "I'm a Virtue" from someone it can't identify tells it nothing.
  if v_ink and v_key in ('self_vice', 'self_virtue', 'self_role') then return 'doubted'; end if;

  -- Camp claims: about someone else, or the sender about themselves.
  if v_key in ('claim_vice', 'claim_virtue') then
    v_subj := v_about;
    v_camp := case when v_key = 'claim_vice' then 'vice' else 'virtue' end;
  elsif v_key in ('self_vice', 'self_virtue') then
    v_subj := p_sender;
    v_camp := case when v_key = 'self_vice' then 'vice' else 'virtue' end;
  elsif v_key = 'self_role' then
    -- "I'm the Justice." claims that role's camp (migration 132).
    v_subj := p_sender;
    v_camp := vv_role_camp(p_payload->>'role');
    if v_camp is null then return 'none'; end if;
  end if;

  if v_subj is not null then
    v_truth := case when v_subj = p_bot then v_mycamp else v_known->>v_subj::text end;
    if v_truth is not null then
      -- (Inked, it knows whether the claim is true but not whom to credit.)
      if v_truth = v_camp then
        if not v_ink then
          perform vv_bot_set(p_bot, 'trust', coalesce(v_mem->'trust', '{}'::jsonb)
            || jsonb_build_object(p_sender::text,
                 coalesce((v_mem->'trust'->>p_sender::text)::numeric, 0) + 1));
        end if;
        return 'known_true';
      end if;
      -- Caught in a lie: strongly suspect the liar.
      if not v_ink then
        perform vv_bot_suspect(p_bot, p_sender, 2);
        if not (coalesce(v_mem->'liars', '[]'::jsonb) ? p_sender::text) then
          perform vv_bot_set(p_bot, 'liars',
            coalesce(v_mem->'liars', '[]'::jsonb) || jsonb_build_array(p_sender::text));
        end if;
      end if;
      return 'known_false';
    end if;

    v_believed := vv_bot_believes(p_bot, p_sender);
    -- Remember it either way: batch 2 checks unverified claims in the Quiz /
    -- Market. Keep the last 30.
    perform vv_bot_set(p_bot, 'claims', (
      select coalesce(jsonb_agg(c), '[]'::jsonb) from (
        select c from jsonb_array_elements(
          coalesce(v_mem->'claims', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'from', case when v_ink then null else p_sender::text end,
            'about', v_subj::text, 'camp', v_camp,
            'day', v_day, 'believed', v_believed))) with ordinality t(c, n)
        order by n desc limit 30) x));
    if v_believed then
      perform vv_bot_suspect(p_bot, v_subj, case when v_camp = v_mycamp then -1 else 1 end);
      return 'believed';
    end if;
    return 'doubted';
  end if;

  -- Opinions about a third player.
  if v_key in ('suspect', 'trust', 'vote') and v_about is not null and v_about <> p_bot then
    v_believed := vv_bot_believes(p_bot, p_sender);
    if v_believed then
      v_delta := case when v_key = 'trust' then -0.5 else 0.5 end;
      -- Never start suspecting someone it KNOWS is on its side.
      if not (v_delta > 0 and (v_known->>v_about::text) = v_mycamp) then
        perform vv_bot_suspect(p_bot, v_about, v_delta);
      end if;
      return 'believed';
    end if;
    return 'doubted';
  end if;

  return 'none';
end;
$$;
revoke all on function vv_bot_hear(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The Outreach step (130's): when someone sent several messages at once, a
-- bare reaction among them isn't answered on its own, and only the last one
-- may get a question tacked on.
create or replace function vv_bot_outreach_step(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day integer; v_started timestamptz; b record; m record;
  v_seen timestamptz; v_last timestamptz; v_outcome text;
  v_replies int; v_rday int; v_init_at timestamptz; v_more boolean;
begin
  select day, coalesce(phase_started_at, now()) into v_day, v_started
    from rooms where id = p_room_id;

  for b in
    select p.id, s.bot_memory from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and p.is_bot and not p.dead
  loop
    begin
      perform vv_bot_persona(b.id);
      v_seen := coalesce((b.bot_memory->>'dm_seen')::timestamptz, '-infinity'::timestamptz);
      v_last := null;
      v_rday := coalesce((b.bot_memory->'replies'->>'day')::int, -1);
      v_replies := case when v_rday = v_day
                        then coalesce((b.bot_memory->'replies'->>'n')::int, 0) else 0 end;

      for m in
        select sender_id, payload, created_at from dm_messages
        where room_id = p_room_id and recipient_id = b.id and day = v_day
          and payload is not null
          and created_at > v_seen and created_at <= now() - interval '2 seconds'
        order by created_at
      loop
        v_last := m.created_at;
        v_outcome := vv_bot_hear(b.id, m.sender_id, m.payload);
        -- More from the same player still waiting in this batch (132)?
        v_more := exists (
          select 1 from dm_messages m2
           where m2.room_id = p_room_id and m2.recipient_id = b.id
             and m2.sender_id = m.sender_id and m2.day = v_day
             and m2.payload is not null and m2.created_at > m.created_at
             and m2.created_at <= now() - interval '2 seconds');
        if v_more and coalesce(m.payload->>'s', '') in
             ('believe', 'disbelieve', 'check', 'no_idea', 'thanks', 'bye') then
          null;   -- just a reaction, and they wrote more: answer that instead
        elsif v_replies < 11 then
          perform vv_bot_reply(b.id, m.sender_id, m.payload, v_outcome, not v_more);
          v_replies := v_replies + 1;
        elsif v_replies = 11 and coalesce(m.payload->>'s', '') <> 'bye' then
          perform vv_send_sentence(b.id, m.sender_id, 'bye', null);
          v_replies := v_replies + 1;
        end if;
      end loop;

      if v_last is not null then
        perform vv_bot_set(b.id, 'dm_seen', to_jsonb(v_last));
        perform vv_bot_set(b.id, 'replies', jsonb_build_object('day', v_day, 'n', v_replies));
      end if;

      -- Its own moment to start a conversation, rolled once per day.
      if coalesce((b.bot_memory->'init'->>'day')::int, -1) = v_day then
        v_init_at := (b.bot_memory->'init'->>'at')::timestamptz;
      else
        v_init_at := v_started + make_interval(secs => 15 + random() * 45);
        perform vv_bot_set(b.id, 'init', jsonb_build_object('day', v_day, 'at', v_init_at));
      end if;
      if now() >= v_init_at
         and not exists (select 1 from dm_messages
                         where room_id = p_room_id and sender_id = b.id and day = v_day) then
        perform vv_bot_initiate(b.id);
      end if;
    exception when others then
      raise warning 'vv_bot_outreach_step: bot % failed: %', b.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function vv_bot_outreach_step(uuid) from public, anon, authenticated;

commit;

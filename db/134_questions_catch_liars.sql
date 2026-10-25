-- 134: Outreach — more questions, and lies you can catch
--
-- * New questions for everyone: "Who should we vote for?", "Do you have any
--   information on anyone?" and "How do you know that?". Bots ask the first
--   two as well (with side / role: four questions, each at most once per
--   player per day).
-- * Bot-only answers to "How do you know that?" (players can't send these):
--   "I read their soul in today's Quiz." / "… in an earlier Quiz.", "I worked
--   it out from a Quiz hint.", "I used a camp reveal potion on them.", "My
--   ability showed me their role.", "<X> told me.", "Just a hunch.", "What do
--   you mean?".
-- * Catching a liar. An honest bot answers truthfully: vv_bot_learn now records
--   where each camp came from, and a believed claim credits whoever told it.
--   A lying bot invents a source when it makes the claim. A careful one picks
--   something it can stand behind; a careless one (each bot has a "care"
--   level, 0.5–0.9) says something that can't be true: "<you> told me.", a
--   second Quiz read on the same day (there's one Quiz choice a day), an
--   earlier Quiz or a potion on day 1 (the Market opens after Outreach), or
--   "my ability showed me their role" when it claimed a role other than
--   Certainty.
-- * Bots keep a consistent story about themselves (vv_bot_story): the same
--   side and role every time a player asks, and one cover role for everyone
--   they lie to — but a careless liar sometimes invents a different role, or
--   changes it when asked twice, so comparing notes can catch them. A Virtue
--   now bluffs only about its role (it never claims to be a Vice).
--
-- Requires 132 and 133. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Sentences. New questions for everyone, plus the bot-only answers to "How do
-- you know that?" ('suspect' / 'ask_suspect' stay renderable for old messages).
create or replace function vv_sentence_needs_about(p_key text)
returns boolean language sql immutable as $$
  select p_key in ('claim_vice', 'claim_virtue', 'suspect', 'trust', 'vote', 'src_told');
$$;

create or replace function vv_sentence_bot_only(p_key text)
returns boolean language sql immutable as $$
  select p_key in ('src_quiz_today', 'src_quiz', 'src_hint', 'src_market',
                   'src_ability', 'src_told', 'src_hunch', 'huh');
$$;

create or replace function vv_sentence_text(p_key text, p_about_name text)
returns text language sql immutable as $$
  select case p_key
    when 'claim_vice'     then coalesce(p_about_name, 'Someone') || ' is a Vice.'
    when 'claim_virtue'   then coalesce(p_about_name, 'Someone') || ' is a Virtue.'
    when 'self_virtue'    then 'I''m a Virtue.'
    when 'self_vice'      then 'I''m a Vice.'
    when 'self_role'      then 'I''m the ' || coalesce(p_about_name, '…') || '.'
    when 'suspect'        then 'I suspect ' || coalesce(p_about_name, 'someone') || '.'
    when 'trust'          then 'I trust ' || coalesce(p_about_name, 'someone') || '.'
    when 'vote'           then 'Let''s vote ' || coalesce(p_about_name, 'someone') || ' out.'
    when 'ask_suspect'    then 'Who do you suspect?'
    when 'ask_side'       then 'Which side are you on?'
    when 'ask_role'       then 'Which role are you?'
    when 'ask_vote'       then 'Who should we vote for?'
    when 'ask_info'       then 'Do you have any information on anyone?'
    when 'ask_how'        then 'How do you know that?'
    when 'believe'        then 'I believe you.'
    when 'disbelieve'     then 'I don''t believe you.'
    when 'check'          then 'I''ll check that.'
    when 'no_idea'        then 'No idea yet.'
    when 'thanks'         then 'Thanks.'
    when 'bye'            then 'Talk tomorrow.'
    when 'src_quiz_today' then 'I read their soul in today''s Quiz.'
    when 'src_quiz'       then 'I read their soul in an earlier Quiz.'
    when 'src_hint'       then 'I worked it out from a Quiz hint.'
    when 'src_market'     then 'I used a camp reveal potion on them.'
    when 'src_ability'    then 'My ability showed me their role.'
    when 'src_told'       then coalesce(p_about_name, 'Someone') || ' told me.'
    when 'src_hunch'      then 'Just a hunch.'
    when 'huh'            then 'What do you mean?'
    else null end;
$$;

-- Players can't send the bot-only answers (bots call vv_send_sentence directly).
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
  if vv_sentence_bot_only(p_sentence) then
    return jsonb_build_object('ok', false, 'reason', 'bad_sentence');
  end if;
  return vv_send_sentence(p_sender_id, p_recipient_id, p_sentence, p_about, p_role);
end;
$$;
grant execute on function send_dm_sentence(uuid, uuid, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- How carefully a bot lies (0.5–0.9, rolled once): the chance an invented
-- story holds up. The rest of the time it slips.
create or replace function vv_bot_care(p_bot uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v numeric;
begin
  select (bot_memory->>'care')::numeric into v from player_secrets where player_id = p_bot;
  if v is null then
    v := round((0.5 + random() * 0.4)::numeric, 2);
    perform vv_bot_set(p_bot, 'care', to_jsonb(v));
  end if;
  return v;
end;
$$;
revoke all on function vv_bot_care(uuid) from public, anon, authenticated;

-- What a bot tells this player about ITSELF ('side' → 'vice'/'virtue', or
-- 'role' → a role id), kept consistent: whether the player gets the truth is
-- settled the first time they ask (allies always do; a Vice lies to everyone
-- else; a Virtue sometimes hides its role behind another Virtue role), and the
-- answer is repeated after that. Liars share one cover role for the whole game
-- — so comparing notes doesn't catch a careful one — but a careless liar may
-- make up a fresh role, or change its story when asked twice.
-- bot_memory.told = {<player id>: {lie, side, role}}, bot_memory.cover = role.
create or replace function vv_bot_story(p_bot uuid, p_partner uuid, p_what text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mem jsonb; v_role text; v_camp text; v_told jsonb; v_lie boolean; v_val text;
  v_care numeric; v_bluff numeric; v_ally boolean; v_cover text;
begin
  select s.bot_memory, s.role, vv_role_camp(s.role) into v_mem, v_role, v_camp
    from player_secrets s where s.player_id = p_bot;
  v_care := vv_bot_care(p_bot);
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  v_told := coalesce(v_mem->'told'->p_partner::text, '{}'::jsonb);

  if v_told ? 'lie' then
    v_lie := (v_told->>'lie')::boolean;
  else
    v_ally := coalesce((vv_bot_known(p_bot)->>p_partner::text) = v_camp
                       and not vv_bot_tormented(p_bot), false);
    v_lie := not v_ally and (v_camp is distinct from 'virtue' or random() < v_bluff);
  end if;

  v_val := v_told->>p_what;
  if v_val is not null then
    if not (p_what = 'role' and v_lie and random() > (1 + v_care) / 2) then
      return v_val;                          -- the same answer as before
    end if;
    v_val := vv_bot_role_bluff(p_bot, 'virtue');   -- slipped: a different role
  elsif p_what = 'side' then
    v_val := case when v_camp = 'vice' and not v_lie then 'vice' else 'virtue' end;
  elsif not v_lie then
    v_val := v_role;
  else
    v_cover := v_mem->>'cover';
    if v_cover is null then
      v_cover := vv_bot_role_bluff(p_bot, 'virtue');
      perform vv_bot_set(p_bot, 'cover', to_jsonb(v_cover));
    end if;
    v_val := case when random() > v_care then vv_bot_role_bluff(p_bot, 'virtue') else v_cover end;
  end if;

  perform vv_bot_set(p_bot, 'told',
    coalesce((select bot_memory->'told' from player_secrets where player_id = p_bot), '{}'::jsonb)
    || jsonb_build_object(p_partner::text, v_told || jsonb_build_object('lie', v_lie, p_what, v_val)));
  return v_val;
end;
$$;
revoke all on function vv_bot_story(uuid, uuid, text) from public, anon, authenticated;

-- How it REALLY knows about p_about: {s: the src_* sentence, from}. A camp it
-- learned → where (bot_memory.src, recorded by vv_bot_learn since 134); one it
-- worked out → a Quiz hint; a claim it believed → who told it; else a hunch.
create or replace function vv_bot_true_source(p_bot uuid, p_about uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_mem jsonb; v_day int; v_src jsonb; v_from text;
begin
  select s.bot_memory, r.day into v_mem, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce(v_mem->'known', '{}'::jsonb) ? p_about::text then
    v_src := v_mem->'src'->p_about::text;
    return jsonb_build_object('s', case v_src->>'how'
      when 'ability' then 'src_ability'
      when 'market' then 'src_market'
      else (case when coalesce((v_src->>'day')::int, v_day) = v_day
                 then 'src_quiz_today' else 'src_quiz' end) end);
  end if;
  if vv_bot_known(p_bot) ? p_about::text then
    return jsonb_build_object('s', 'src_hint');
  end if;
  select c->>'from' into v_from
    from jsonb_array_elements(coalesce(v_mem->'claims', '[]'::jsonb)) c
   where c->>'about' = p_about::text and c->>'from' is not null
     and coalesce((c->>'believed')::boolean, false)
   limit 1;
  if v_from is not null then
    return jsonb_build_object('s', 'src_told', 'from', v_from);
  end if;
  return jsonb_build_object('s', 'src_hunch');
end;
$$;
revoke all on function vv_bot_true_source(uuid, uuid) from public, anon, authenticated;

-- An INVENTED source for a claim it's lying about. A careful liar picks one it
-- can stand behind: an informant who's alive to ask, a hunch, one Quiz read a
-- day, the Market only from day 2 (it opens after Outreach), "my ability" only
-- if it claimed Certainty. A careless one says something that can't be true:
-- "<you> told me.", a second Quiz read today, an earlier Quiz or a potion on
-- day 1, or "my ability" behind a role that has no such power.
create or replace function vv_bot_fake_source(p_bot uuid, p_partner uuid, p_about uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day int; v_mem jsonb; v_said jsonb; v_role text;
  v_qtaken boolean; v_opts text[] := '{}'; v_pick text; v_from uuid;
begin
  select p.room_id, r.day, s.bot_memory into v_room, v_day, v_mem
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  v_said := case when coalesce((v_mem->'said'->>'day')::int, -1) = v_day
                 then v_mem->'said' else '{}'::jsonb end;
  -- Has it already claimed today's Quiz read for someone else?
  select exists (
    select 1
      from jsonb_each(v_said) k,
           jsonb_array_elements(case when jsonb_typeof(k.value) = 'array'
                                     then k.value else '[]'::jsonb end) e
     where e->>'s' = 'src_quiz_today' and e->>'about' is distinct from p_about::text)
    into v_qtaken;
  -- The role it told this player it has (or will: its cover).
  v_role := coalesce(v_mem->'told'->p_partner::text->>'role', v_mem->>'cover');

  if random() > vv_bot_care(p_bot) then
    v_opts := array['told_you'];
    if v_qtaken then v_opts := v_opts || array['src_quiz_today']; end if;
    if v_day <= 1 then v_opts := v_opts || array['src_quiz', 'src_market']; end if;
    if v_role is distinct from 'certainty' then v_opts := v_opts || array['src_ability']; end if;
  else
    select p.id into v_from
      from players p
     where p.room_id = v_room and p.id not in (p_bot, p_partner, p_about)
     order by p.dead, random() limit 1;
    if v_from is not null then v_opts := v_opts || array['src_told']; end if;
    if p_key = 'vote' then v_opts := v_opts || array['src_hunch']; end if;
    if not v_qtaken then v_opts := v_opts || array['src_quiz_today']; end if;
    if v_day >= 2 then v_opts := v_opts || array['src_quiz', 'src_market']; end if;
    if v_role = 'certainty' then v_opts := v_opts || array['src_ability']; end if;
  end if;

  select x into v_pick from unnest(v_opts) x order by random() limit 1;
  if v_pick = 'told_you' then
    return jsonb_build_object('s', 'src_told', 'from', p_partner::text);
  elsif v_pick = 'src_told' then
    return jsonb_build_object('s', 'src_told', 'from', v_from::text);
  end if;
  return jsonb_build_object('s', coalesce(v_pick, 'src_hunch'));
end;
$$;
revoke all on function vv_bot_fake_source(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Send a claim about a third player ("X is a Vice.", "Let's vote X out.") and
-- settle, there and then, how it'll say it knows: the truth when p_honest,
-- else an invented source — or, for a careful liar, the one it already gave
-- someone today for this player. bot_memory.said = {day, <player id>:
-- [{about, key, s, from}]}. Returns whether it was sent.
create or replace function vv_bot_say(
  p_bot uuid, p_partner uuid, p_key text, p_about uuid, p_honest boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_res jsonb; v_src jsonb; v_day int; v_said jsonb;
begin
  v_res := vv_send_sentence(p_bot, p_partner, p_key, p_about);
  if not coalesce((v_res->>'ok')::boolean, false) then return false; end if;
  if p_about is null or p_key not in ('claim_vice', 'claim_virtue', 'vote') then return true; end if;

  select coalesce(s.bot_memory->'said', '{}'::jsonb), r.day into v_said, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce((v_said->>'day')::int, -1) <> v_day then
    v_said := jsonb_build_object('day', v_day);
  end if;

  if p_honest then
    v_src := vv_bot_true_source(p_bot, p_about);
  else
    if random() <= vv_bot_care(p_bot) then
      select e - 'about' - 'key' into v_src
        from jsonb_each(v_said) k,
             jsonb_array_elements(case when jsonb_typeof(k.value) = 'array'
                                       then k.value else '[]'::jsonb end) e
       where e->>'about' = p_about::text
         and (e->>'from') is distinct from p_partner::text
       limit 1;
    end if;
    v_src := coalesce(v_src, vv_bot_fake_source(p_bot, p_partner, p_about, p_key));
  end if;

  perform vv_bot_set(p_bot, 'said', v_said || jsonb_build_object(p_partner::text,
    coalesce(v_said->p_partner::text, '[]'::jsonb)
    || jsonb_build_array(v_src || jsonb_build_object('about', p_about::text, 'key', p_key))));
  return true;
end;
$$;
revoke all on function vv_bot_say(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;

-- Four questions now (side, role, vote, info); each at most once per player per
-- day. "How do you know that?" is asked by players only — answering it takes
-- the bot-only sentences.
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
  select q into v_q from unnest(array['ask_side', 'ask_role', 'ask_vote', 'ask_info']) q
   where not (coalesce(v_asked->p_other::text, '[]'::jsonb) ? q)
   order by random() limit 1;
  return v_q;
end;
$$;
revoke all on function vv_bot_next_question(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Answer one message (132's, extended). New: "Who should we vote for?", "Do
-- you have any information on anyone?" and "How do you know that?" — the last
-- answered with the source it settled on when it made its latest claim to this
-- player. What it says about itself comes from vv_bot_story; claims about
-- others go through vv_bot_say.
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
  v_style text; v_bluff numeric; v_mycamp text; v_known jsonb; v_room uuid; v_day int;
  v_reply text; v_reply_about uuid; v_reply_role text; v_claim_honest boolean;
  v_t uuid; v_tcamp text; v_honest boolean; v_ally boolean;
  v_next text; v_follow boolean := false; v_res jsonb; v_ok boolean;
  v_said jsonb; v_last jsonb;
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  v_style := vv_bot_persona(p_bot)->>'style';
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  select vv_role_camp(s.role), p.room_id, r.day, s.bot_memory->'said'
    into v_mycamp, v_room, v_day, v_said
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
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
  elsif v_key = 'vote' then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_vote');
  elsif v_key in ('claim_vice', 'claim_virtue') then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_info');
  end if;
  v_next := vv_bot_next_question(p_bot, p_sender);

  if v_key = 'bye' then
    return;                                   -- the conversation is over
  elsif v_key = 'thanks' then
    v_reply := case when v_next is not null and random() < 0.5 then v_next else 'bye' end;
  elsif v_key in ('believe', 'disbelieve', 'check', 'no_idea') or vv_sentence_bot_only(v_key) then
    -- Keep it going while it still has something to ask.
    if v_next is not null and random() < 0.8 then
      v_reply := v_next;
    else
      v_reply := case when random() < 0.6 then 'thanks' else 'bye' end;
    end if;

  elsif v_key = 'ask_side' then
    v_reply := case when vv_bot_story(p_bot, p_sender, 'side') = 'vice'
                    then 'self_vice' else 'self_virtue' end;
    v_follow := true;

  elsif v_key = 'ask_role' then
    v_reply := 'self_role';
    v_reply_role := vv_bot_story(p_bot, p_sender, 'role');
    v_follow := true;

  elsif v_key in ('ask_vote', 'ask_suspect') then
    -- Who it really wants out (for a Vice, that's a Virtue it knows of), else
    -- — if it's a Vice, or bluffing — someone anyway.
    v_t := vv_bot_target(p_bot, false);
    if v_t = p_sender then v_t := null; end if;
    if v_t is not null and (v_honest or v_mycamp <> 'virtue') then
      v_reply := 'vote'; v_reply_about := v_t; v_claim_honest := true;
    elsif v_mycamp <> 'virtue' or not v_honest then
      select p.id into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender)
         and (v_known->>p.id::text) is distinct from v_mycamp
       order by random() limit 1;
      if v_t is not null and random() < 0.6 then
        v_reply := 'vote'; v_reply_about := v_t; v_claim_honest := false;
      else
        v_reply := 'no_idea';
      end if;
    else
      v_reply := 'no_idea';
    end if;
    v_follow := true;

  elsif v_key = 'ask_info' then
    -- Someone whose camp it knows (not itself, not the asker), an enemy first.
    select k.key::uuid, k.value #>> '{}' into v_t, v_tcamp
      from jsonb_each(v_known) k
      join players p on p.id::text = k.key and p.room_id = v_room and not p.dead
     where k.key not in (p_bot::text, p_sender::text)
       and (k.value #>> '{}') in ('vice', 'virtue')
     order by (k.value #>> '{}') = v_mycamp, random()
     limit 1;
    if v_ally or (v_mycamp = 'virtue' and v_honest) then
      if v_t is not null then
        v_reply := 'claim_' || v_tcamp; v_reply_about := v_t; v_claim_honest := true;
      else
        v_reply := 'no_idea';
      end if;
    elsif v_mycamp = 'virtue' then
      v_reply := 'no_idea';                   -- keeping it to itself today
    elsif v_t is not null and v_tcamp = 'virtue' and random() < 0.7 then
      v_reply := 'claim_vice'; v_reply_about := v_t; v_claim_honest := false;   -- frame
    elsif v_t is not null and v_tcamp = 'vice' and random() < 0.5 then
      v_reply := 'claim_virtue'; v_reply_about := v_t; v_claim_honest := false; -- cover
    elsif random() < 0.5 then
      select p.id into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender)
         and (v_known->>p.id::text) is distinct from v_mycamp
       order by random() limit 1;
      if v_t is not null then
        v_reply := 'claim_vice'; v_reply_about := v_t; v_claim_honest := false;   -- invent
      else
        v_reply := 'no_idea';
      end if;
    else
      v_reply := 'no_idea';
    end if;
    v_follow := true;

  elsif v_key = 'ask_how' then
    -- Its latest claim to this player today, backed by the story it settled
    -- on then (true, or invented — and an invented one may not hold up).
    if coalesce((v_said->>'day')::int, -1) = v_day
       and jsonb_typeof(v_said->p_sender::text) = 'array' then
      v_last := v_said->p_sender::text->(-1);
    end if;
    if v_last is not null then
      v_reply := v_last->>'s';
      v_reply_about := (v_last->>'from')::uuid;
    else
      v_reply := 'huh';                       -- nothing it said needs backing up
    end if;
    v_follow := true;

  elsif v_key in ('suspect', 'vote') and v_about = p_bot then
    -- Accused: defend itself (its story, which for a Vice is a lie).
    v_reply := case when vv_bot_story(p_bot, p_sender, 'side') = 'vice'
                    then 'disbelieve' else 'self_virtue' end;
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

  if v_claim_honest is not null then
    v_ok := vv_bot_say(p_bot, p_sender, v_reply, v_reply_about, v_claim_honest);
  else
    v_res := vv_send_sentence(p_bot, p_sender, v_reply, v_reply_about, v_reply_role);
    v_ok := coalesce((v_res->>'ok')::boolean, false);
  end if;
  if not v_ok then return; end if;
  if v_reply in ('ask_side', 'ask_role', 'ask_vote', 'ask_info') then
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
-- Open a conversation (133's): claims go through vv_bot_say, "I'm a Virtue."
-- through the bot's story, and it can open with any of the four questions.
create or replace function vv_bot_initiate(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_mycamp text; v_bluff numeric; v_known jsonb; v_sus jsonb;
  v_partner uuid; v_ally boolean; v_t uuid; v_tcamp text; v_lie boolean;
  v_key text; v_about uuid; v_honest boolean; v_res jsonb;
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
      v_key := case when v_tcamp in ('vice', 'virtue') then 'claim_' || v_tcamp else 'vote' end;
      v_about := v_t; v_honest := true;
    elsif v_mycamp = 'vice' and v_tcamp = 'virtue' then
      v_key := 'claim_vice'; v_about := v_t; v_honest := false;   -- frame a known Virtue
    elsif v_mycamp = 'vice' then
      v_key := case when vv_bot_story(p_bot, v_partner, 'side') = 'vice'
                    then 'self_vice' else 'self_virtue' end;
    else
      -- A Virtue's bluff: point at someone it has no case against.
      select p.id into v_about
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, v_partner, v_t)
       order by random() limit 1;
      if v_about is not null then
        v_key := 'vote'; v_honest := false;
      else
        v_key := coalesce(vv_bot_next_question(p_bot, v_partner), 'ask_side');
      end if;
    end if;
  else
    -- Nothing it wants to share right now: ask.
    v_key := coalesce(vv_bot_next_question(p_bot, v_partner), 'ask_side');
  end if;

  if v_honest is not null then
    perform vv_bot_say(p_bot, v_partner, v_key, v_about, v_honest);
    return;
  end if;
  v_res := vv_send_sentence(p_bot, v_partner, v_key, v_about);
  if coalesce((v_res->>'ok')::boolean, false)
     and v_key in ('ask_side', 'ask_role', 'ask_vote', 'ask_info') then
    perform vv_bot_mark_asked(p_bot, v_partner, v_key);
  end if;
end;
$$;
revoke all on function vv_bot_initiate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Learning (131's) + where it learned it.
create or replace function vv_bot_learn(p_bot uuid, p_target uuid, p_camp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp text; v_mem jsonb; c jsonb;
  v_keep jsonb := '[]'::jsonb; v_trust jsonb; v_liars jsonb;
  v_phase text; v_day int;
begin
  if p_bot is null or p_target is null or p_camp is null then return; end if;
  v_camp := case when p_camp in ('vice', 'virtue') then p_camp else 'neutral' end;

  update player_secrets
     set bot_memory = jsonb_set(bot_memory, '{known}',
           coalesce(bot_memory->'known', '{}'::jsonb) || jsonb_build_object(p_target::text, v_camp))
   where player_id = p_bot;

  -- Where it learned it (134), for "How do you know that?". Bots act inside
  -- the phase, so the phase says how: its ability (role action), a camp
  -- reveal potion (store), else the Quiz. The first source is kept.
  select r.phase, r.day into v_phase, v_day
    from players p join rooms r on r.id = p.room_id
   where p.id = p_bot;
  update player_secrets
     set bot_memory = jsonb_set(bot_memory, '{src}',
           coalesce(bot_memory->'src', '{}'::jsonb) || jsonb_build_object(p_target::text,
             jsonb_build_object('how', case v_phase when 'role_action' then 'ability'
                                                    when 'store' then 'market'
                                                    else 'quiz' end,
                                'day', v_day)))
   where player_id = p_bot
     and not (coalesce(bot_memory->'src', '{}'::jsonb) ? p_target::text);

  select bot_memory into v_mem from player_secrets where player_id = p_bot;
  v_trust := coalesce(v_mem->'trust', '{}'::jsonb);
  v_liars := coalesce(v_mem->'liars', '[]'::jsonb);

  for c in select * from jsonb_array_elements(coalesce(v_mem->'claims', '[]'::jsonb)) loop
    if c->>'about' = p_target::text then
      if c->>'from' is null then
        null;   -- told while inked (131): nobody to credit or blame
      elsif c->>'camp' = v_camp then
        v_trust := v_trust || jsonb_build_object(c->>'from',
                     coalesce((v_trust->>(c->>'from'))::numeric, 0) + 1);
      else
        if not (v_liars ? (c->>'from')) then
          v_liars := v_liars || jsonb_build_array(c->>'from');
        end if;
        perform vv_bot_suspect(p_bot, (c->>'from')::uuid, 2);
      end if;
    else
      v_keep := v_keep || jsonb_build_array(c);
    end if;
  end loop;

  -- Merge onto the CURRENT memory (vv_bot_suspect just wrote 'sus').
  update player_secrets
     set bot_memory = bot_memory || jsonb_build_object('claims', v_keep, 'trust', v_trust, 'liars', v_liars)
   where player_id = p_bot;
end;
$$;
revoke all on function vv_bot_learn(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hearing (132's) + the new questions.
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

  if v_key in ('ask_suspect', 'ask_side', 'ask_role', 'ask_vote', 'ask_info', 'ask_how') then
    return 'question';
  end if;
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

commit;

-- Migration 130 — Bots start conversations, end them, and check what they're told
--
-- Batch 2 of the Outreach sentences (129). Design (Matthijs, 2026-10-26):
--   * BOTS START CONVERSATIONS. If nobody has written to a bot by its own random
--     moment (15-60s into Outreach), it opens one — with a known / believed ally
--     if it has one, else anyone alive (humans AND bots, so bots trade
--     information with each other too). It shares what it knows: truthfully
--     with an ally; with anyone else a Virtue mostly tells the truth and a Vice
--     mostly deceives (frames a known Virtue, claims to be a Virtue). Nothing to
--     share → a question or a camp claim. Still ONE partner per cycle.
--   * CONVERSATIONS END. Every message from its partner gets an answer — only
--     "Talk tomorrow." (new, with "Thanks.") closes it — so nobody is left on
--     read, and two bots can't loop. Answers can be bluffs too: with its bluff
--     chance a bot says "I believe you." to a claim it doubts, or knows is a lie.
--   * CLAIMS GET CHECKED. In the next Quiz a bot reads the soul of the player a
--     claim was about (usually even while saving — a peek costs no SE); a rich
--     bot checks sooner with a camp reveal in the Market. Learning a camp by ANY
--     means (Quiz, Certainty, potion) now settles every claim about that player:
--     a true one earns its sender trust, a false one marks them a liar.
--
-- Redefines vv_sentence_text, vv_bot_learn, vv_bot_reply, vv_bot_outreach_step
-- (129/125) and vv_bot_quiz / vv_bot_store (128, patched). Adds vv_bot_initiate
-- and vv_bot_claim_to_check. Everything stays revoked from clients.
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Two closing sentences, so a conversation can END instead of trailing off.
create or replace function vv_sentence_text(p_key text, p_about_name text)
returns text language sql immutable as $$
  select case p_key
    when 'claim_vice'   then coalesce(p_about_name, 'Someone') || ' is a Vice.'
    when 'claim_virtue' then coalesce(p_about_name, 'Someone') || ' is a Virtue.'
    when 'self_virtue'  then 'I''m a Virtue.'
    when 'self_vice'    then 'I''m a Vice.'
    when 'suspect'      then 'I suspect ' || coalesce(p_about_name, 'someone') || '.'
    when 'trust'        then 'I trust ' || coalesce(p_about_name, 'someone') || '.'
    when 'vote'         then 'Let''s vote ' || coalesce(p_about_name, 'someone') || ' out.'
    when 'ask_suspect'  then 'Who do you suspect?'
    when 'ask_side'     then 'Which side are you on?'
    when 'believe'      then 'I believe you.'
    when 'disbelieve'   then 'I don''t believe you.'
    when 'check'        then 'I''ll check that.'
    when 'no_idea'      then 'No idea yet.'
    when 'thanks'       then 'Thanks.'
    when 'bye'          then 'Talk tomorrow.'
    else null end;
$$;

-- ---------------------------------------------------------------------------
-- Learning a camp now also SETTLES every claim the bot was told about that
-- player: a true one earns its sender trust, a false one marks them a liar
-- (strong suspicion). Same signature as 125's, so every caller — Quiz peeks,
-- Certainty, camp-reveal potions — checks claims for free.
create or replace function vv_bot_learn(p_bot uuid, p_target uuid, p_camp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp text; v_mem jsonb; c jsonb;
  v_keep jsonb := '[]'::jsonb; v_trust jsonb; v_liars jsonb;
begin
  if p_bot is null or p_target is null or p_camp is null then return; end if;
  v_camp := case when p_camp in ('vice', 'virtue') then p_camp else 'neutral' end;

  update player_secrets
     set bot_memory = jsonb_set(bot_memory, '{known}',
           coalesce(bot_memory->'known', '{}'::jsonb) || jsonb_build_object(p_target::text, v_camp))
   where player_id = p_bot;

  select bot_memory into v_mem from player_secrets where player_id = p_bot;
  v_trust := coalesce(v_mem->'trust', '{}'::jsonb);
  v_liars := coalesce(v_mem->'liars', '[]'::jsonb);

  for c in select * from jsonb_array_elements(coalesce(v_mem->'claims', '[]'::jsonb)) loop
    if c->>'about' = p_target::text then
      if c->>'camp' = v_camp then
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

-- The player behind the newest claim the bot hasn't been able to check yet
-- (still alive, camp still unknown), or null.
create or replace function vv_bot_claim_to_check(p_bot uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_known jsonb; v_t uuid;
begin
  v_known := vv_bot_known(p_bot);
  select (c->>'about')::uuid into v_t
    from player_secrets s,
         jsonb_array_elements(coalesce(s.bot_memory->'claims', '[]'::jsonb)) with ordinality t(c, n)
   where s.player_id = p_bot
     and c->>'about' <> p_bot::text
     and not (v_known ? (c->>'about'))
     and exists (select 1 from players pl where pl.id = (c->>'about')::uuid and not pl.dead)
   order by n
   limit 1;
  return v_t;
end;
$$;
revoke all on function vv_bot_claim_to_check(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Answer one message. Every message from its partner gets an answer except
-- "Talk tomorrow." (the natural end) — no more leaving people on read. And
-- what a bot SAYS can differ from what it thinks: with its bluff chance it
-- answers "I believe you." to a claim it doubts, or even knows is a lie.
create or replace function vv_bot_reply(p_bot uuid, p_sender uuid, p_payload jsonb, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_about uuid;
  v_style text; v_bluff numeric; v_mycamp text; v_known jsonb; v_room uuid;
  v_reply text; v_reply_about uuid; v_t uuid; v_honest boolean;
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  v_style := vv_bot_persona(p_bot)->>'style';
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  select vv_role_camp(s.role), p.room_id into v_mycamp, v_room
    from player_secrets s join players p on p.id = s.player_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);
  v_honest := random() >= v_bluff;

  if v_key = 'bye' then
    return;                                   -- the conversation is over
  elsif v_key = 'thanks' then
    v_reply := 'bye';
  elsif v_key in ('believe', 'disbelieve', 'check', 'no_idea') then
    v_reply := case when random() < 0.6 then 'thanks' else 'bye' end;

  elsif v_key = 'ask_side' then
    -- To a known ally: the truth. Otherwise a Vice nearly always claims
    -- Virtue, and a Virtue tells the truth unless it's bluffing.
    if (v_known->>p_sender::text) = v_mycamp then
      v_reply := case when v_mycamp = 'vice' then 'self_vice' else 'self_virtue' end;
    elsif v_mycamp = 'vice' then
      v_reply := case when random() < 0.9 then 'self_virtue' else 'self_vice' end;
    else
      v_reply := case when v_honest then 'self_virtue' else 'self_vice' end;
    end if;

  elsif v_key = 'ask_suspect' then
    if v_honest then
      v_t := vv_bot_target(p_bot, false);
      if v_t is not null and v_t <> p_sender then
        v_reply := 'suspect'; v_reply_about := v_t;
      else
        v_reply := 'no_idea';
      end if;
    else
      select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender);
      if v_t is not null then v_reply := 'suspect'; v_reply_about := v_t;
      else v_reply := 'no_idea'; end if;
    end if;

  elsif v_key in ('suspect', 'vote') and v_about = p_bot then
    -- Accused: defend itself (a Vice lies about its camp).
    v_reply := case when v_mycamp = 'vice' and random() < 0.9 then 'self_virtue'
                    when v_mycamp = 'vice' then 'disbelieve'
                    else 'self_virtue' end;
  elsif v_key = 'trust' and v_about = p_bot then
    v_reply := 'thanks';

  elsif p_outcome in ('known_true', 'believed') then
    v_reply := case when p_outcome = 'believed' and v_style <> 'trusting' and random() < 0.3
                    then 'check' else 'believe' end;
  elsif p_outcome in ('known_false', 'doubted') then
    if random() < v_bluff then
      v_reply := 'believe';                   -- keep its doubts to itself
    elsif p_outcome = 'known_false' then
      v_reply := 'disbelieve';
    else
      v_reply := case when v_style = 'skeptical' and random() < 0.5 then 'check'
                      when random() < 0.6 then 'disbelieve' else 'check' end;
    end if;
  else
    v_reply := 'no_idea';                     -- never leave it unanswered
  end if;

  perform vv_send_sentence(p_bot, p_sender, v_reply, v_reply_about);
end;
$$;
revoke all on function vv_bot_reply(uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Open a conversation (nobody wrote to it first). Partner: a known or believed
-- ally if it has one, else anyone alive. Opening line: what it knows — shared
-- truthfully with an ally; with anyone else a Virtue mostly tells the truth
-- and a Vice mostly deceives (frames a known Virtue, claims to be a Virtue);
-- with nothing to share, a question or a camp claim.
create or replace function vv_bot_initiate(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_mycamp text; v_bluff numeric; v_known jsonb; v_sus jsonb;
  v_partner uuid; v_ally boolean; v_t uuid; v_tcamp text; v_lie boolean;
  v_key text; v_about uuid; r numeric;
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
     and ((v_known->>p.id::text) = v_mycamp
          or coalesce((v_sus->>p.id::text)::numeric, 0) < 0)
   order by random() limit 1;
  if v_partner is null then
    select p.id into v_partner
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and (v_known->>p.id::text) is distinct from case when v_mycamp = 'vice' then 'virtue' else 'vice' end
     order by random() limit 1;
  end if;
  if v_partner is null then
    select p.id into v_partner
      from players p where p.room_id = v_room and p.id <> p_bot and not p.dead
     order by random() limit 1;
  end if;
  if v_partner is null then return; end if;

  v_ally := (v_known->>v_partner::text) = v_mycamp
            or coalesce((v_sus->>v_partner::text)::numeric, 0) < 0;
  v_lie := not v_ally and random() < case when v_mycamp = 'vice'
                                          then least(0.9, v_bluff + 0.35)
                                          else v_bluff end;

  v_t := vv_bot_target(p_bot, false);
  if v_t = v_partner then v_t := null; end if;
  v_tcamp := v_known->>v_t::text;

  if v_t is not null then
    if not v_lie then
      -- What it actually knows (or suspects).
      if v_tcamp in ('vice', 'virtue') then
        v_key := 'claim_' || v_tcamp; v_about := v_t;
      else
        v_key := 'suspect'; v_about := v_t;
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
      v_key := case when v_about is not null then 'suspect' else 'ask_suspect' end;
    end if;
  else
    r := random();
    if r < 0.35 then
      v_key := 'ask_side';
    elsif r < 0.7 then
      v_key := 'ask_suspect';
    elsif v_mycamp = 'vice' and not v_ally then
      v_key := 'self_virtue';                  -- the usual Vice lie
    else
      v_key := case when v_mycamp = 'vice' then 'self_vice' else 'self_virtue' end;
    end if;
  end if;

  perform vv_send_sentence(p_bot, v_partner, v_key, v_about);
end;
$$;
revoke all on function vv_bot_initiate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Every tick in Outreach: each living bot reads what arrived (after a short,
-- human-ish delay) and answers; if nobody has written to it by its own random
-- moment (15-60s in), it opens a conversation itself. A bot answers at most 12
-- messages a day — the last one is always "Talk tomorrow."
create or replace function vv_bot_outreach_step(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day integer; v_started timestamptz; b record; m record;
  v_seen timestamptz; v_last timestamptz; v_outcome text;
  v_replies int; v_rday int; v_init_at timestamptz;
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
        if v_replies < 11 then
          perform vv_bot_reply(b.id, m.sender_id, m.payload, v_outcome);
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

-- ---------------------------------------------------------------------------
-- Quiz (128's) — checks a claim first.
create or replace function vv_bot_quiz(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_se numeric; v_camp text; v_unknown uuid; v_choice text := 'points';
  v_res jsonb; v_quiz jsonb; r numeric; v_saving boolean; v_has_target boolean;
  v_check uuid;
begin
  select p.soul_energy, vv_role_camp(s.role) into v_se, v_camp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_unknown := vv_bot_unknown(p_bot);
  v_saving := vv_bot_reserve(p_bot) > 0;
  v_has_target := vv_bot_target(p_bot) is not null;
  -- Something it was told and hasn't checked (migration 130).
  v_check := vv_bot_claim_to_check(p_bot);

  -- Saving up, already holding a target, short on Soul Energy, or nothing left
  -- to learn → bank the 100.
  if v_check is not null and random() < (case when v_saving then 0.4 else 0.8 end) then
    -- Check a claim: read the soul of the player it was about. vv_bot_learn
    -- then settles every claim about them (sender trusted, or a liar).
    v_choice := 'peek';
    v_unknown := v_check;
  elsif not v_saving and v_unknown is not null and v_se >= 100 then
    r := random();
    if v_has_target then
      v_choice := case when r < 0.2 then 'hint' else 'points' end;
    elsif v_camp = 'virtue' then
      v_choice := case when r < 0.55 then 'peek' when r < 0.8 then 'hint' else 'points' end;
    else
      v_choice := case when r < 0.4 then 'peek' when r < 0.65 then 'hint' else 'points' end;
    end if;
  end if;

  v_res := submit_quiz_choice_impl(p_bot, v_choice,
             case when v_choice = 'peek' then v_unknown end);
  if coalesce((v_res->>'ok')::boolean, false) then
    v_quiz := v_res->'quiz';
    if v_quiz->>'choice' = 'peek' and jsonb_typeof(v_quiz->'peek') = 'object' then
      perform vv_bot_learn(p_bot, (v_quiz->'peek'->>'target')::uuid, v_quiz->'peek'->>'camp');
    elsif v_quiz->>'choice' = 'hint' and jsonb_typeof(v_quiz->'hint') = 'object' then
      perform vv_bot_hint(p_bot, v_quiz->'hint');
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_quiz(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Market (128's) — a rich bot checks a claim with a camp reveal.
create or replace function vv_bot_store(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_se numeric; v_camp text; v_role text; v_day integer;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_kill_armed boolean; v_hosp_armed boolean; v_protected boolean; v_iron boolean; v_mult boolean;
  v_t uuid; v_res jsonb; v_known jsonb; v_buys int := 0;
  v_role_kills boolean; v_threat boolean; v_eye_fresh boolean;
begin
  select p.room_id, p.soul_energy, vv_role_camp(s.role), s.role, r.day,
         p.dead, p.in_prison, p.in_hospital,
         s.potion_kill_target is not null, s.potion_hosp_target is not null,
         coalesce(s.potion_protect, false), coalesce(s.potion_iron_will, false),
         coalesce(s.potion_minigame_mult, false),
         coalesce((s.bot_memory->'eye'->>'day')::int, 0) >= r.day
    into v_room, v_se, v_camp, v_role, v_day, v_dead, v_prison, v_hosp,
         v_kill_armed, v_hosp_armed, v_protected, v_iron, v_mult, v_eye_fresh
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_room is null or v_dead or v_prison or v_hosp then return; end if;

  -- Its own role can already kill (and the next role phase will fund it).
  v_role_kills := v_role in ('murder', 'justice');

  -- (1) A KNOWN enemy: deal with it here unless the role will. Can't afford it
  --     yet → set a savings goal (the role phase and the Quiz respect it).
  v_t := vv_bot_enemy(p_bot, null, true, true);
  if v_t is not null and not v_role_kills and not v_kill_armed then
    if v_se >= 300 and random() < 0.75 then
      v_res := buy_potion_impl(p_bot, 'kill', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 300;
        perform vv_bot_set(p_bot, 'goal', null);
      end if;
    elsif not v_hosp_armed and v_se >= 200 and random() < 0.4 then
      v_res := buy_potion_impl(p_bot, 'hospitalise', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 200;
      end if;
    else
      perform vv_bot_set(p_bot, 'goal', jsonb_build_object(
        'kind', 'kill', 'target', v_t::text, 'day', v_day));
    end if;
  elsif v_t is null and not v_kill_armed then
    -- A strongly suspected enemy and plenty to spend: take the shot.
    v_t := vv_bot_target(p_bot, true, false, 2);
    if v_t is not null and not v_role_kills
       and v_se >= 450 and random() < 0.35 then
      v_res := buy_potion_impl(p_bot, 'kill', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 300;
      end if;
    end if;
  end if;

  -- (2) Team in danger → protection. No recent count → maybe check with the Eye.
  v_threat := vv_bot_threatened(p_bot);
  if not v_eye_fresh and v_day >= 2 and v_se >= 300 and random() < 0.3 then
    v_res := buy_potion_impl(p_bot, 'eye', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      perform vv_bot_set(p_bot, 'eye', jsonb_build_object(
        'vices', (v_res->>'vices')::int, 'virtues', (v_res->>'virtues')::int, 'day', v_day));
      v_buys := v_buys + 1; v_se := v_se - 150;
      v_threat := vv_bot_threatened(p_bot);
    end if;
  end if;
  if v_buys < 3 and v_threat and not v_protected and v_se >= 200 and random() < 0.8 then
    v_res := buy_potion_impl(p_bot, 'protect', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (2b) Rich, and told something it hasn't checked → check it now with a
  --      camp reveal instead of waiting for the next Quiz (migration 130).
  v_t := vv_bot_claim_to_check(p_bot);
  if v_buys < 3 and v_t is not null and v_se >= 400 and random() < 0.6 then
    v_res := buy_potion_impl(p_bot, 'camp_reveal', v_t);
    if coalesce((v_res->>'ok')::boolean, false) then
      perform vv_bot_learn(p_bot, v_t, v_res->>'camp');
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (3) Blind → buy information: a camp reveal on someone unknown.
  if v_buys < 3 and vv_bot_target(p_bot) is null and v_se >= 250
     and random() < (case when v_camp = 'virtue' then 0.5 else 0.35 end) then
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null then
      v_res := buy_potion_impl(p_bot, 'camp_reveal', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        perform vv_bot_learn(p_bot, v_t, v_res->>'camp');
        v_buys := v_buys + 1; v_se := v_se - 200;
      end if;
    end if;
  end if;

  -- (4) A known enemy still free to vote out → double this vote (day 2+).
  if v_buys < 3 and v_day >= 2 and not v_iron
     and vv_bot_reserve(p_bot) = 0 and v_se >= 250 and random() < 0.4
     and vv_bot_enemy(p_bot, null, false, true) is not null then
    v_res := buy_potion_impl(p_bot, 'iron_will', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (5) Cheap spare Soul Energy, nothing to save for → double the next Quiz.
  if v_buys < 3 and not v_mult and vv_bot_reserve(p_bot) = 0
     and v_se between 60 and 260 and random() < 0.25 then
    v_res := buy_potion_impl(p_bot, 'minigame_mult', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 60;
    end if;
  end if;

  -- (6) Chip in to free a jailed KNOWN ally.
  if vv_bot_reserve(p_bot) = 0 and v_se >= 250 and random() < 0.5 then
    v_known := vv_bot_known(p_bot);
    select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_t
      from players p
     where p.room_id = v_room and p.in_prison and not p.dead and p.id <> p_bot
       and (v_known->>p.id::text) = v_camp;
    if v_t is not null then
      perform contribute_release_impl(p_bot, v_t);
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_store(uuid) from public, anon, authenticated;

commit;

-- Migration 129 — Premade Outreach sentences; bots read, believe and reply (batch 1)
--
-- Design (Matthijs, 2026-10-26):
--   * Outreach gains a set of PREMADE SENTENCES (camps only — no role claims):
--       claim_vice / claim_virtue  "<X> is a Vice." / "<X> is a Virtue."
--       self_virtue / self_vice    "I'm a Virtue." / "I'm a Vice."
--       suspect / trust / vote     "I suspect <X>." / "I trust <X>." / "Let's vote <X> out."
--       ask_suspect / ask_side     "Who do you suspect?" / "Which side are you on?"
--       believe / disbelieve / check / no_idea   (replies)
--     Humans can send them to anyone (next to free text); with a bot they are
--     the only way to talk. The meaning is stored as dm_messages.payload
--     {s, about}; the server also renders the text (for Empathy and dead
--     spectators), while live clients render it with their own display names
--     so an Envy swap still reads correctly.
--   * send_dm_sentence enforces exactly send_dm's rules (alive, same room,
--     mutes, ONE partner per cycle unless Sociability / Communication potion).
--   * BOTS read every message sent to them (as anyone can) and update their
--     memory: a claim they can already check (they know the camp) marks the
--     sender truthful or a liar; otherwise they decide whether to believe it by
--     PERSONALITY (trusting / balanced / skeptical, per bot) and by what they
--     know of the sender. Every unchecked claim is remembered for batch 2's
--     verification. They REPLY with standard sentences — but only to their one
--     partner (the first person they answer), like everyone else. Both camps
--     sometimes BLUFF (per-bot rate: Virtues ~10-30%, Vices ~35-60%), and a
--     Vice nearly always claims to be a Virtue to anyone it doesn't trust.
--   * A bot that believes someone is on its side no longer picks them in its
--     random fallback (vv_bot_enemy step 3).
--
-- Redefines vv_tick_room (127's, plus one call) and vv_bot_enemy (125's, plus
-- the believed-ally preference). Safe to re-run.

begin;

alter table dm_messages add column if not exists payload jsonb;

-- ---------------------------------------------------------------------------
-- Sentences
create or replace function vv_sentence_needs_about(p_key text)
returns boolean language sql immutable as $$
  select p_key in ('claim_vice', 'claim_virtue', 'suspect', 'trust', 'vote');
$$;

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
    else null end;
$$;

-- Internal send — every rule send_dm applies, for players (via the gated
-- wrapper below) and for bots (called from the bot step).
create or replace function vv_send_sentence(
  p_sender uuid, p_recipient uuid, p_key text, p_about uuid default null
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
  insert into dm_messages (room_id, sender_id, recipient_id, day, text, payload)
  values (v_room, p_sender, p_recipient, v_day, v_text,
          jsonb_build_object('s', p_key,
                             'about', case when vv_sentence_needs_about(p_key)
                                           then p_about::text end));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function vv_send_sentence(uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function send_dm_sentence(
  p_sender_id uuid, p_recipient_id uuid, p_sentence text, p_about uuid default null
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
  return vv_send_sentence(p_sender_id, p_recipient_id, p_sentence, p_about);
end;
$$;
grant execute on function send_dm_sentence(uuid, uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bot personality: how readily it believes (trusting / balanced / skeptical)
-- and how often it bluffs. Rolled once per bot, on first use.
create or replace function vv_bot_persona(p_bot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_p jsonb; v_camp text; r numeric;
begin
  select s.bot_memory->'persona', vv_role_camp(s.role) into v_p, v_camp
    from player_secrets s where s.player_id = p_bot;
  if v_p is not null then return v_p; end if;
  r := random();
  v_p := jsonb_build_object(
    'style', case when r < 1.0/3 then 'trusting' when r < 2.0/3 then 'balanced' else 'skeptical' end,
    'bluff', round((case when v_camp = 'vice' then 0.35 + random() * 0.25
                         else 0.10 + random() * 0.20 end)::numeric, 2));
  perform vv_bot_set(p_bot, 'persona', v_p);
  return v_p;
end;
$$;
revoke all on function vv_bot_persona(uuid) from public, anon, authenticated;

-- Does the bot take this sender at their word? Personality, then what it knows
-- of the sender: a caught liar or known enemy almost never; a known ally almost
-- always; earned trust and suspicion nudge it.
create or replace function vv_bot_believes(p_bot uuid, p_sender uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_style text; v_camp text; v_mem jsonb; v_known jsonb; v_p numeric;
  v_trust numeric; v_sus numeric;
begin
  v_style := vv_bot_persona(p_bot)->>'style';
  select vv_role_camp(s.role), s.bot_memory into v_camp, v_mem
    from player_secrets s where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);

  if coalesce(v_mem->'liars', '[]'::jsonb) ? p_sender::text then return random() < 0.05; end if;

  v_p := case v_style when 'trusting' then 0.75 when 'skeptical' then 0.2 else 0.5 end;
  if (v_known->>p_sender::text) = v_camp then
    v_p := case v_style when 'trusting' then 0.97 when 'skeptical' then 0.75 else 0.9 end;
  elsif v_known ? p_sender::text then
    v_p := case v_style when 'trusting' then 0.2 when 'skeptical' then 0.03 else 0.1 end;
  end if;

  v_trust := coalesce((v_mem->'trust'->>p_sender::text)::numeric, 0);
  v_sus := coalesce((v_mem->'sus'->>p_sender::text)::numeric, 0);
  v_p := least(0.98, greatest(0.02, v_p + 0.15 * v_trust - 0.15 * greatest(v_sus, 0)));
  return random() < v_p;
end;
$$;
revoke all on function vv_bot_believes(uuid, uuid) from public, anon, authenticated;

-- Take in one message. Returns how it landed:
--   known_true / known_false   the bot could already check it
--   believed / doubted         an unchecked claim or opinion
--   question / none            nothing to weigh
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

  if v_key in ('ask_suspect', 'ask_side') then return 'question'; end if;

  -- Camp claims: about someone else, or the sender about themselves.
  if v_key in ('claim_vice', 'claim_virtue') then
    v_subj := v_about;
    v_camp := case when v_key = 'claim_vice' then 'vice' else 'virtue' end;
  elsif v_key in ('self_vice', 'self_virtue') then
    v_subj := p_sender;
    v_camp := case when v_key = 'self_vice' then 'vice' else 'virtue' end;
  end if;

  if v_subj is not null then
    v_truth := case when v_subj = p_bot then v_mycamp else v_known->>v_subj::text end;
    if v_truth is not null then
      if v_truth = v_camp then
        perform vv_bot_set(p_bot, 'trust', coalesce(v_mem->'trust', '{}'::jsonb)
          || jsonb_build_object(p_sender::text,
               coalesce((v_mem->'trust'->>p_sender::text)::numeric, 0) + 1));
        return 'known_true';
      end if;
      -- Caught in a lie: strongly suspect the liar.
      perform vv_bot_suspect(p_bot, p_sender, 2);
      if not (coalesce(v_mem->'liars', '[]'::jsonb) ? p_sender::text) then
        perform vv_bot_set(p_bot, 'liars',
          coalesce(v_mem->'liars', '[]'::jsonb) || jsonb_build_array(p_sender::text));
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
            'from', p_sender::text, 'about', v_subj::text, 'camp', v_camp,
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

-- Answer one message with a standard sentence (to its partner only — the send
-- itself enforces the one-partner rule, so a locked bot simply stays quiet).
create or replace function vv_bot_reply(p_bot uuid, p_sender uuid, p_payload jsonb, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_style text; v_bluff numeric; v_mycamp text; v_known jsonb; v_room uuid;
  v_reply text; v_about uuid; v_t uuid; v_honest boolean;
begin
  v_style := vv_bot_persona(p_bot)->>'style';
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  select vv_role_camp(s.role), p.room_id into v_mycamp, v_room
    from player_secrets s join players p on p.id = s.player_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);
  v_honest := random() >= v_bluff;

  if v_key = 'ask_side' then
    -- To a known ally: the truth. Otherwise a Vice nearly always claims Virtue,
    -- and a Virtue tells the truth unless it's bluffing.
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
        v_reply := 'suspect'; v_about := v_t;
      else
        v_reply := 'no_idea';
      end if;
    else
      -- Bluff: point at someone it has no case against.
      select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender);
      if v_t is not null then v_reply := 'suspect'; v_about := v_t; else v_reply := 'no_idea'; end if;
    end if;

  elsif p_outcome in ('known_true', 'believed') then
    v_reply := case when p_outcome = 'believed' and v_style <> 'trusting' and random() < 0.3
                    then 'check' else 'believe' end;
  elsif p_outcome = 'known_false' then
    v_reply := 'disbelieve';
  elsif p_outcome = 'doubted' then
    v_reply := case when v_style = 'skeptical' and random() < 0.5 then 'check'
                    when random() < 0.6 then 'disbelieve' else 'check' end;
  else
    return;   -- replies to replies would loop forever
  end if;

  perform vv_send_sentence(p_bot, p_sender, v_reply, v_about);
end;
$$;
revoke all on function vv_bot_reply(uuid, uuid, jsonb, text) from public, anon, authenticated;

-- Every tick during Outreach: each living bot reads what arrived since it last
-- looked (after a short, human-ish delay) and answers its partner.
create or replace function vv_bot_outreach_step(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day integer; b record; m record; v_seen timestamptz; v_last timestamptz;
  v_outcome text; v_replies int; v_rday int;
begin
  select day into v_day from rooms where id = p_room_id;

  for b in
    select p.id, s.bot_memory from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and p.is_bot and not p.dead
  loop
    begin
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
        if v_replies < 8 then
          perform vv_bot_reply(b.id, m.sender_id, m.payload, v_outcome);
          v_replies := v_replies + 1;
        end if;
      end loop;

      if v_last is not null then
        perform vv_bot_set(b.id, 'dm_seen', to_jsonb(v_last));
        perform vv_bot_set(b.id, 'replies', jsonb_build_object('day', v_day, 'n', v_replies));
      end if;
    exception when others then
      raise warning 'vv_bot_outreach_step: bot % failed: %', b.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function vv_bot_outreach_step(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- vv_bot_enemy: 125's, but the random fallback skips believed allies.
create or replace function vv_bot_enemy(
  p_bot uuid,
  p_candidates uuid[] default null,
  p_active_only boolean default true,
  p_known_only boolean default false,
  p_prefer_humans boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_camp text; v_sus jsonb; v_known jsonb;
  v_pool uuid[]; v_humans uuid[]; v_pick uuid; v_max numeric;
begin
  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_camp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  if v_room is null then return null; end if;
  v_known := vv_bot_known(p_bot);

  select coalesce(array_agg(p.id), '{}') into v_pool
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and (not p_active_only or (not p.in_prison and not p.in_hospital))
     and (p_candidates is null or p.id = any(p_candidates))
     and (v_known->>p.id::text) is distinct from v_camp;          -- never an ally

  if p_prefer_humans then
    select coalesce(array_agg(id), '{}') into v_humans
      from players where id = any(v_pool) and not is_bot;
    if coalesce(array_length(v_humans, 1), 0) > 0 then v_pool := v_humans; end if;
  end if;

  -- 1) a known enemy (allies are already out of the pool)
  select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
    from unnest(v_pool) x where v_known ? x::text;
  if v_pick is not null or p_known_only then return v_pick; end if;

  -- 2) the most suspicious of the rest
  select max(coalesce((v_sus->>x::text)::numeric, 0)) into v_max from unnest(v_pool) x;
  if coalesce(v_max, 0) > 0 then
    select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
      from unnest(v_pool) x
     where coalesce((v_sus->>x::text)::numeric, 0) = v_max;
    if v_pick is not null then return v_pick; end if;
  end if;

  -- 3) anyone left — but not someone it BELIEVES is on its side (negative
  --    suspicion, e.g. a believed "I'm a Virtue"), while anyone else qualifies
  --    (migration 129).
  select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
    from unnest(v_pool) x where coalesce((v_sus->>x::text)::numeric, 0) >= 0;
  return coalesce(v_pick, vv_random_pick(v_pool));
end;
$$;
revoke all on function vv_bot_enemy(uuid, uuid[], boolean, boolean, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- vv_tick_room: 127's, plus the bots' Outreach step.
create or replace function vv_tick_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
  v_key text;
  v_voters int; v_voted int;
  v_tally jsonb;
begin
  -- The server is acting (see header): host-gated resolvers accept this
  -- transaction for the rest of its life.
  perform set_config('vv.server_tick', 'on', true);

  select * into r from rooms where id = p_room_id for update;
  if not found or not r.server_hosted or r.phase = 'game_over' then return; end if;

  -- First tick in a new phase / day / re-vote: entry work.
  v_key := r.phase || ':' || r.day || ':' || coalesce(md5(r.revote_candidates::text), '-');
  if r.server_phase_key is distinct from v_key then
    if r.phase in ('vice_victory_intro', 'virtue_victory_intro', 'soul_victory_intro') then
      -- Reached from a resolver, which doesn't reset ready: start the
      -- Continue majority clean (bots stay ready).
      update players set ready = false where room_id = p_room_id and not is_bot;
    end if;
    update rooms set server_phase_key = v_key, server_substate = null where id = p_room_id;
    r.server_phase_key := v_key;
    r.server_substate := null;
  end if;

  -- Bots move once per phase / day / re-vote (idempotent inside).
  perform run_bots(p_room_id);
  select * into r from rooms where id = p_room_id;

  if r.phase = 'role_select' then
    -- Bots pick, then lock, each on its own random schedule (migration 127).
    perform vv_bot_role_select_step(p_room_id);
    -- Ends once every HUMAN has locked (nobody waits on a bot: one still
    -- deciding is handed its planned role), or at the deadline.
    if not exists (select 1 from players p join player_secrets s on s.player_id = p.id
                   where p.room_id = p_room_id and s.role is null and not p.is_bot)
       or (r.phase_ends_at is not null and now() >= r.phase_ends_at + interval '1.5 seconds') then
      update player_secrets s set role_choice = s.bot_memory->>'plan'
        from players p
       where p.id = s.player_id and p.room_id = p_room_id and p.is_bot
         and s.role is null and s.bot_memory ? 'plan';
      perform resolve_role_select(p_room_id);
    end if;

  elsif r.phase = 'role_overview' then
    if vv_srv_continue(p_room_id) then
      update players set ready = false where room_id = p_room_id;
      update rooms set phase = 'lore_intro', phase_ends_at = null where id = p_room_id;
    end if;

  elsif r.phase = 'lore_intro' then
    -- Reading the card: majority ready, or 15s. Then the 3.5s flight
    -- (clients play it when phase_ends_at appears), then on.
    if r.phase_ends_at is null then
      if (select t.o_total > 0 and t.o_ready * 2 > t.o_total
            from vv_srv_electorate(p_room_id, 'active') t)
         or now() >= coalesce(r.phase_started_at, now()) + interval '15 seconds' then
        update rooms set phase_ends_at = now() + interval '3.5 seconds' where id = p_room_id;
      end if;
    elsif now() >= r.phase_ends_at + interval '0.5 seconds' then
      if r.role_assign_mode = 'choose' then
        perform vv_srv_start_role_action(p_room_id);
      else
        update players set ready = false where room_id = p_room_id;
        update rooms set phase = 'role_reveal', phase_ends_at = null where id = p_room_id;
      end if;
    end if;

  elsif r.phase = 'role_reveal' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_role_action(p_room_id); end if;

  elsif r.phase = 'role_action' then
    if vv_srv_timed(p_room_id) then perform vv_srv_resolve_role_action(p_room_id); end if;

  elsif r.phase = 'event_summary' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_minigame(p_room_id); end if;

  elsif r.phase = 'minigame' then
    if vv_srv_timed(p_room_id) then
      perform apply_quiz_awards(p_room_id);
      update players set ready = false where room_id = p_room_id;
      update rooms set phase = 'result', phase_ends_at = null where id = p_room_id;
    end if;

  elsif r.phase = 'result' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_outreach(p_room_id); end if;

  elsif r.phase = 'outreach' then
    -- Bots read their messages and answer their partner (migration 129).
    perform vv_bot_outreach_step(p_room_id);
    if vv_srv_timed(p_room_id, 'living') then
      perform enter_store(p_room_id, now() + interval '60 seconds');
    end if;

  elsif r.phase = 'store' then
    if vv_srv_timed(p_room_id) then
      perform resolve_store(p_room_id);
      perform resolve_soul_last_standing(p_room_id);
    end if;

  elsif r.phase = 'store_summary' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_consultation(p_room_id); end if;

  elsif r.phase = 'consultation' then
    if r.server_substate is distinct from 'voted' then
      select count(*), count(*) filter (where has_voted) into v_voters, v_voted
        from players
       where room_id = p_room_id and not dead and not in_prison and not in_hospital;
      if v_voted < v_voters then
        -- Time's up: whoever hasn't voted skips (incl. anyone disconnected).
        if r.phase_ends_at is not null
           and now() >= r.phase_ends_at + interval '1.5 seconds' then
          perform submit_vote_impl(p.id, 'skip')
             from players p
            where p.room_id = p_room_id and not p.dead and not p.in_prison
              and not p.in_hospital and not p.has_voted;
        end if;
        return;
      end if;
      -- Everyone has voted. A first-round tie goes straight to the re-vote
      -- (the host's old decision); anything else opens the result screen.
      v_tally := consultation_tally(p_room_id);
      if v_tally->>'kind' = 'tie' and r.revote_candidates is null then
        perform start_revote(p_room_id, coalesce(v_tally->'tied_ids', '[]'::jsonb));
        return;
      end if;
      update players set ready = false where room_id = p_room_id;
      update rooms set server_substate = 'voted', phase_ends_at = null where id = p_room_id;
      return;
    end if;
    if vv_srv_continue(p_room_id) then
      perform resolve_consultation(p_room_id);
      perform resolve_soul_last_standing(p_room_id);
    end if;

  elsif r.phase = 'new_day' then
    if r.phase_ends_at is null or now() >= r.phase_ends_at then
      perform vv_srv_start_next_day(p_room_id);
    end if;

  elsif r.phase = 'vice_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'vice'); end if;

  elsif r.phase = 'virtue_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'virtue'); end if;

  elsif r.phase = 'soul_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'neutral'); end if;
  end if;
end;
$$;
revoke all on function vv_tick_room(uuid) from public, anon, authenticated;

commit;

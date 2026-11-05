-- 143: Outreach limits, Pride's broadcast, and new role prices
-- (Matthijs, 2026-11-05).
--
-- OUTREACH (humans; bots are exempt from the character limits):
--   * Start ONE chat per Outreach: you may write first to one player only, but
--     you can always answer anyone who wrote to you. (Sociability and a
--     Communication-potion buyer may still start chats with everyone.)
--   * 250 characters per Outreach in total, at most 100 to any one player.
--     Every message counts as it reads (a premade sentence by its text).
--   * Pride's broadcast day (day_powers, 142): nobody writes privately; Pride
--     posts to a read-only global chat (250 characters) — outreach_broadcast,
--     read with outreach_state.
-- PRICES: Murder's kill 200, Intoxication's hospitalise 125, Wrath's and
--   Love's conversion 250. The server now holds the kill / hospitalise prices
--   (queue_action used to charge whatever the client sent). Justice's shield
--   and kill are refused once the court is live (his court ability, 142,
--   replaces them).
--
-- Requires 142. Safe to re-run.

begin;

create or replace function vv_outreach_n(p_key text)
returns integer language sql immutable as $$
  select case p_key
    when 'total'      then 250   -- characters per Outreach
    when 'per_person' then 100   -- characters to any one player
  end;
$$;

-- ---------------------------------------------------------------------------
-- Pride's global chat (locked; read through outreach_state).
create table if not exists outreach_broadcast (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  sender_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists outreach_broadcast_room_day on outreach_broadcast (room_id, day);
alter table outreach_broadcast enable row level security;

drop trigger if exists vv_outreach_broadcast_nudge_ins on outreach_broadcast;
create trigger vv_outreach_broadcast_nudge_ins after insert on outreach_broadcast
  referencing new table as changed_rows
  for each statement execute function vv_players_changed_stmt();

-- ---------------------------------------------------------------------------
-- May this message go out? null = yes, else the reason.
create or replace function vv_dm_check(
  p_room uuid, p_sender uuid, p_recipient uuid, p_day integer, p_len integer
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_bot boolean; v_role text; v_comms boolean; v_total integer; v_to integer;
begin
  select p.is_bot, s.role, coalesce(s.potion_comms, false)
    into v_bot, v_role, v_comms
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_sender;

  -- Pride's broadcast day: nobody writes privately.
  if exists (select 1 from day_powers
              where room_id = p_room and day = p_day and power = 'pride_broadcast') then
    return 'broadcast_day';
  end if;

  -- Start one chat; always answer someone who wrote to you.
  if not v_comms and v_role is distinct from 'sociability'
     and not exists (select 1 from dm_messages
                      where room_id = p_room and day = p_day
                        and sender_id = p_recipient and recipient_id = p_sender)
     and exists (
       -- someone else this sender wrote to first today
       select 1 from dm_messages m
        where m.room_id = p_room and m.day = p_day and m.sender_id = p_sender
          and m.recipient_id <> p_recipient
          and not exists (select 1 from dm_messages x
                           where x.room_id = p_room and x.day = p_day
                             and x.sender_id = m.recipient_id and x.recipient_id = p_sender
                             and x.created_at < m.created_at)) then
    return 'partner_locked';
  end if;

  if not coalesce(v_bot, false) then
    select coalesce(sum(length(text)), 0)::integer,
           coalesce(sum(length(text)) filter (where recipient_id = p_recipient), 0)::integer
      into v_total, v_to
      from dm_messages
     where room_id = p_room and day = p_day and sender_id = p_sender;
    if v_total + p_len > vv_outreach_n('total') then return 'char_limit'; end if;
    if v_to + p_len > vv_outreach_n('per_person') then return 'char_limit_person'; end if;
  end if;
  return null;
end;
$$;
revoke all on function vv_dm_check(uuid, uuid, uuid, integer, integer) from public, anon, authenticated;

-- Free-text DM (115's body; the limits from vv_dm_check).
create or replace function send_dm(
  p_room_id uuid, p_sender_id uuid, p_recipient_id uuid, p_day int, p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_dead boolean; v_rec_room uuid;
  v_comms boolean; v_existing uuid;
  v_role text; v_muted boolean; v_muted_day int; v_day int; v_why text;
begin
  if not vv_is_me(p_sender_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_text is null or length(btrim(p_text)) = 0 then return; end if;
  select room_id, dead into v_room, v_dead from players where id = p_sender_id;
  if v_room is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_room is distinct from p_room_id then raise exception 'wrong room' using errcode = '42501'; end if;
  if v_dead then raise exception 'cannot chat' using errcode = '42501'; end if;
  select room_id into v_rec_room from players where id = p_recipient_id;
  if v_rec_room is distinct from v_room then raise exception 'recipient not in room' using errcode = '42501'; end if;

  select coalesce(s.potion_comms, false), s.role, p.muted, p.ability_muted_day, r.day
    into v_comms, v_role, v_muted, v_muted_day, v_day
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_sender_id;

  -- NEW: mutes enforced server-side. Covers the report auto-mute (previously
  -- client-only) as well as Sociability's.
  --
  -- Deliberately NOT exempted by the Communication potion: letting a purchase
  -- lift a moderation mute would sell a way out of being reported. The potion's
  -- immunity is applied at mute TIME instead — sociability_mute simply doesn't
  -- silence a buyer — so it counters the ability without touching moderation.
  if coalesce(v_muted, false) or v_muted_day is not distinct from v_day then
    raise exception 'muted' using errcode = '42501';
  end if;

  -- One chat started per Outreach, answers always allowed, 250 / 100
  -- characters (migration 143). The server's day, not the client's.
  v_why := vv_dm_check(v_room, p_sender_id, p_recipient_id, v_day, length(p_text));
  if v_why is not null then
    raise exception '%', replace(v_why, '_', ' ') using errcode = '42501';
  end if;

  insert into dm_messages (room_id, sender_id, recipient_id, day, text)
  values (v_room, p_sender_id, p_recipient_id, v_day, p_text);
end;
$$;
grant execute on function send_dm(uuid, uuid, uuid, int, text) to anon, authenticated;

-- Premade sentences (132's body; the limits from vv_dm_check).
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
  v_about_name text; v_text text; v_why text;
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

  v_text := vv_sentence_text(p_key, v_about_name);
  -- Same limits as send_dm (migration 143).
  v_why := vv_dm_check(v_room, p_sender, p_recipient, v_day, length(v_text));
  if v_why is not null then
    return jsonb_build_object('ok', false, 'reason', v_why);
  end if;
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

-- ---------------------------------------------------------------------------
-- Pride posts to the global chat on his broadcast day.
create or replace function pride_broadcast_send(p_player_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_dead boolean;
  v_muted boolean; v_muted_day integer; v_text text; v_used integer;
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.room_id, r.day, r.phase, p.dead, p.muted, p.ability_muted_day
    into v_room, v_day, v_phase, v_dead, v_muted, v_muted_day
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player_id;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'outreach' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if not exists (select 1 from day_powers
                  where room_id = v_room and day = v_day and player_id = p_player_id
                    and power = 'pride_broadcast') then
    return jsonb_build_object('ok', false, 'reason', 'not_broadcasting');
  end if;
  if v_dead then return jsonb_build_object('ok', false, 'reason', 'cannot_chat'); end if;
  if coalesce(v_muted, false) or v_muted_day is not distinct from v_day then
    return jsonb_build_object('ok', false, 'reason', 'muted');
  end if;
  v_text := btrim(coalesce(p_text, ''));
  if length(v_text) = 0 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  select coalesce(sum(length(text)), 0)::integer into v_used
    from outreach_broadcast
   where room_id = v_room and day = v_day and sender_id = p_player_id;
  if v_used + length(v_text) > vv_outreach_n('total') then
    return jsonb_build_object('ok', false, 'reason', 'char_limit');
  end if;
  insert into outreach_broadcast (room_id, day, sender_id, text)
  values (v_room, v_day, p_player_id, v_text);
  return jsonb_build_object('ok', true, 'left', vv_outreach_n('total') - v_used - length(v_text));
end;
$$;
grant execute on function pride_broadcast_send(uuid, text) to anon, authenticated;

-- What the Outreach screen needs: the day's broadcast (once Outreach has
-- begun — never earlier, so the role phase can't give Pride away) and the
-- viewer's own limits.
create or replace function outreach_state(p_room_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r rooms%rowtype; v_by uuid; v_used integer; v_to jsonb; v_started uuid; v_free boolean;
begin
  if not vv_is_me(p_viewer_id)
     or not exists (select 1 from players where id = p_viewer_id and room_id = p_room_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from rooms where id = p_room_id;

  if r.phase in ('outreach', 'store', 'store_summary', 'consultation', 'new_day') then
    select player_id into v_by from day_powers
     where room_id = p_room_id and day = r.day and power = 'pride_broadcast'
     limit 1;
  end if;

  select coalesce(sum(length(text)), 0)::integer into v_used
    from dm_messages where room_id = p_room_id and day = r.day and sender_id = p_viewer_id;
  select coalesce(jsonb_object_agg(recipient_id, n), '{}'::jsonb) into v_to
    from (select recipient_id, sum(length(text))::integer as n
            from dm_messages
           where room_id = p_room_id and day = r.day and sender_id = p_viewer_id
           group by recipient_id) x;
  -- The chat the viewer started (wrote first, before any word from them).
  select m.recipient_id into v_started
    from dm_messages m
   where m.room_id = p_room_id and m.day = r.day and m.sender_id = p_viewer_id
     and not exists (select 1 from dm_messages x
                      where x.room_id = p_room_id and x.day = r.day
                        and x.sender_id = m.recipient_id and x.recipient_id = p_viewer_id
                        and x.created_at < m.created_at)
   order by m.created_at
   limit 1;

  -- Sociability and a Communication-potion buyer may start chats with everyone.
  select coalesce(s.potion_comms, false) or s.role = 'sociability' into v_free
    from player_secrets s where s.player_id = p_viewer_id;

  return jsonb_build_object(
    'day', r.day,
    'broadcast', case when v_by is null then null else jsonb_build_object(
      'by', v_by,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'text', b.text, 'at', b.created_at)
                         order by b.created_at)
          from outreach_broadcast b
         where b.room_id = p_room_id and b.day = r.day), '[]'::jsonb),
      'used', (select coalesce(sum(length(text)), 0)::integer from outreach_broadcast b
                where b.room_id = p_room_id and b.day = r.day)) end,
    'limits', jsonb_build_object(
      'total', vv_outreach_n('total'), 'per_person', vv_outreach_n('per_person'),
      'used', v_used, 'used_to', v_to, 'started_with', v_started,
      'free_start', coalesce(v_free, false)));
end;
$$;
grant execute on function outreach_state(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Role-phase actions: the server holds the kill / hospitalise prices, and
-- Justice's old shield and kill end once the court is live. (The gated
-- queue_action wrapper is untouched.)
create or replace function queue_action_impl(
  p_player_id uuid, p_cost numeric, p_action text, p_target text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_cost numeric;
begin
  select role into v_role from player_secrets where player_id = p_player_id;
  if v_role = 'justice' and p_action in ('kill', 'protect') and vv_court_live() then
    raise exception 'illegal action for role' using errcode = '42501';
  end if;
  v_cost := greatest(coalesce(p_cost, 0),
                     case when p_action = 'kill' and v_role = 'murder' then 200
                          when p_action = 'intox' and v_role = 'intoxication' then 125
                          else 0 end);
  if coalesce((select soul_energy from players where id = p_player_id), 0) < v_cost then
    raise exception 'insufficient soul energy' using errcode = '42501';
  end if;
  update player_secrets
    set pending_action = p_action, pending_target = p_target
  where player_id = p_player_id;
  update players
    set soul_energy = soul_energy - v_cost, acted_this_day = true
  where id = p_player_id;
end;
$$;
revoke all on function queue_action_impl(uuid, numeric, text, text) from public, anon, authenticated;

-- Wrath's corruption and Love's turning: 250 (was 200).
create or replace function convert_player_impl(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_tgt_active boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role not in ('wrath','love') or v_acted
     or v_dead or v_prison or v_hosp or v_se < 250 or p_target_id = p_player_id then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target_id and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;

  -- Queue the conversion; it lands in resolve_role_action AFTER the target's own
  -- action this turn has fired, checked there against a camp/tier snapshot (only
  -- a non-S role of the wanted camp flips; S-tier roles — incl. Wrath/Love — are
  -- immune). Charged now (a gamble); the result comes back to you as a notice.
  update players set soul_energy = soul_energy - 250, acted_this_day = true
  where id = p_player_id;
  update player_secrets set pending_action = 'convert', pending_target = p_target_id::text
  where player_id = p_player_id;
  return jsonb_build_object('ok', true, 'queued', true);
end; $$;
revoke all on function convert_player_impl(uuid, uuid) from public, anon, authenticated;

-- Bots pay the new prices (131's body).
create or replace function vv_bot_role_action(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_camp text; v_se numeric; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_day integer;
  v_t uuid; v_ally uuid; v_role_seen text; v_res jsonb; e jsonb; v jsonb;
  v_jailers uuid[]; v_enemies uuid[]; v_known jsonb;
  v_spend numeric;        -- what it may spend without touching its savings
  v_sure boolean;         -- target is a KNOWN enemy (not just suspected)
  v_threat boolean;
begin
  select p.room_id, s.role, vv_role_camp(s.role), p.soul_energy, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, r.day
    into v_room, v_role, v_camp, v_se, v_acted, v_dead, v_prison, v_hosp, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_room is null or v_dead then return; end if;

  -- A bomb that has sat a full day must be passed: to an enemy it has
  -- information on, else (left alone) it relocates randomly anyway.
  if exists (
       select 1 from rooms r, jsonb_array_elements(coalesce(r.bombs, '[]'::jsonb)) b
       where r.id = v_room and (b->>'holder')::uuid = p_bot
         and coalesce((b->>'since')::int, v_day) < v_day) then
    v_t := vv_bot_target(p_bot);
    if v_t is not null then perform pass_bomb_impl(p_bot, v_t); end if;
  end if;

  -- Imprisoned: only Vengeance acts — revenge on a jailer (she knows them).
  if v_prison then
    if v_role = 'vengeance' and not v_acted and v_se >= 150 then
      select coalesce(array_agg(pl.id), '{}') into v_jailers
        from rooms rm join players pl on pl.room_id = rm.id and not pl.dead
       where rm.id = v_room and rm.vengeance_imprisoners ? pl.id::text;
      foreach v_t in array v_jailers loop
        perform vv_bot_suspect(p_bot, v_t, 1);
      end loop;
      v_t := vv_bot_enemy(p_bot, v_jailers, false);
      if v_t is not null and random() < 0.8 then
        update player_secrets
           set pending_action = 'vengeance_kill',
               pending_target = jsonb_build_array(v_t::text)::text
         where player_id = p_bot;
        update players set soul_energy = soul_energy - 150, acted_this_day = true
         where id = p_bot;
      end if;
    end if;
    return;
  end if;
  if v_hosp or v_acted then return; end if;

  v_spend := v_se - vv_bot_reserve(p_bot);
  v_known := vv_bot_known(p_bot);

  if v_role = 'murder' then
    v_t := vv_bot_target(p_bot);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null and v_spend >= 200
       and random() < (case when v_sure then 0.9 else 0.5 end) then
      perform vv_bot_queue(p_bot, 200, 'kill', v_t::text);
    end if;

  elsif v_role in ('intoxication', 'vengeance') then
    v_t := vv_bot_target(p_bot);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null
       and v_spend >= (case when v_role = 'vengeance' then 150 else 125 end)
       and random() < (case when v_sure then 0.75 else 0.35 end) then
      perform vv_bot_queue(p_bot, case when v_role = 'vengeance' then 150 else 125 end,
                           'intox', v_t::text);
    end if;

  elsif v_role = 'envy' then
    -- Wearing a known enemy's face sends their votes astray.
    v_t := vv_bot_enemy(p_bot, null, true, true);
    if v_t is not null and v_spend >= 100 and random() < 0.45 then
      perform vv_bot_queue(p_bot, 100, 'envy_swap', v_t::text);
    end if;

  elsif v_role = 'torment' then
    -- Any enemy it has information on, bot or human: since migration 131 a
    -- tormented bot can't tell who it's talking to either.
    v_t := vv_bot_target(p_bot, true, false);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null and v_spend >= 100
       and random() < (case when v_sure then 0.6 else 0.3 end) then
      perform vv_bot_queue(p_bot, 100, 'torment', v_t::text);
    end if;

  elsif v_role = 'justice' and not vv_court_live() then
    -- (Once the court is live Justice's ability is in court: the court bots.)
    v_t := vv_bot_enemy(p_bot, null, true, true);      -- a KNOWN Vice only
    v_threat := vv_bot_threatened(p_bot);
    if v_t is not null and v_spend >= 200 and random() < 0.75 then
      perform vv_bot_queue(p_bot, 200, 'kill', v_t::text);
    elsif v_spend >= 100 then
      v_ally := vv_bot_ally(p_bot);
      -- Shield only when it matters: the team is in danger, or a known ally
      -- is worth guarding now and then.
      if v_threat and random() < 0.7 then
        perform vv_bot_queue(p_bot, 100, 'protect',
          (case when v_ally is not null and random() < 0.4 then v_ally else p_bot end)::text);
      elsif v_ally is not null and random() < 0.3 then
        perform vv_bot_queue(p_bot, 100, 'protect', v_ally::text);
      end if;
    end if;

  elsif v_role = 'certainty' then
    -- An information role: reading a role IS how it learns. Holds back while
    -- saving, and once it already has someone to act on.
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null and v_spend >= 125
       and random() < (case when vv_bot_target(p_bot) is null then 0.75 else 0.3 end) then
      v_role_seen := reveal_role_impl(p_bot, v_t);
      if v_role_seen is not null then
        perform vv_bot_learn(p_bot, v_t, vv_role_camp(v_role_seen));
      end if;
    end if;

  elsif v_role = 'empathy' then
    -- Who voted against me / my known allies last time is suspicious.
    if v_day >= 2 and v_spend >= 150
       and random() < (case when vv_bot_target(p_bot) is null then 0.6 else 0.25 end) then
      v_res := reveal_votes_empathy_impl(p_bot);
      for e in select * from jsonb_array_elements(coalesce(v_res, '[]'::jsonb)) loop
        if (e->>'target_id') = p_bot::text
           or (vv_bot_known(p_bot)->>(e->>'target_id')) = v_camp then
          for v in select * from jsonb_array_elements(coalesce(e->'voter_ids', '[]'::jsonb)) loop
            perform vv_bot_suspect(p_bot, (v #>> '{}')::uuid, 1);
          end loop;
        end if;
      end loop;
    end if;

  elsif v_role in ('vice_worshipper', 'virtue_seeker') then
    v_ally := vv_bot_ally(p_bot);
    v_t := vv_bot_enemy(p_bot, null, false, true);      -- guess only among KNOWN enemies
    if v_ally is not null and v_spend >= 100 and random() < 0.5 then
      perform reveal_self_impl(p_bot, v_ally);
    elsif v_t is not null and v_day >= 2 and v_spend >= 100 and random() < 0.3 then
      perform vv_bot_queue(p_bot, 100,
        case when v_role = 'vice_worshipper' then 'worshipper_guess' else 'seeker_guess' end,
        v_t::text);
    end if;

  elsif v_role = 'sacrifice' then
    -- Only worth dying for two KNOWN, active enemies.
    select coalesce(array_agg(p.id order by random()), '{}') into v_enemies
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not p.in_prison and not p.in_hospital
       and v_known ? p.id::text
       and (v_known->>p.id::text) <> v_camp;
    if coalesce(array_length(v_enemies, 1), 0) >= 2 and v_spend >= 400 and random() < 0.7 then
      perform vv_bot_queue(p_bot, 400, 'sacrifice',
        (select jsonb_agg(x::text) from unnest(v_enemies[1:2]) x)::text);
    end if;

  elsif v_role = 'generosity' then
    v_ally := vv_bot_ally(p_bot);
    v_threat := vv_bot_threatened(p_bot);
    if v_ally is not null and v_spend >= 200 and random() < 0.5 then
      perform grant_extra_life_impl(p_bot, v_ally);
    elsif v_threat and v_spend >= 200 and random() < 0.5 then
      perform grant_extra_life_impl(p_bot, p_bot);
    elsif v_ally is not null and v_spend >= 100 and random() < 0.3 then
      perform gift_soul_energy_impl(p_bot, v_ally);
    end if;
  end if;
  -- truthfulness: its ability is on the consultation result screen; bots skip it.
end;
$$;
revoke all on function vv_bot_role_action(uuid) from public, anon, authenticated;

commit;

-- ============================================
-- Migration 032: public has_voted flag + consultation tally (Batch 3b-ii)
-- ============================================
-- Lets the consultation screen stop reading votes. `has_voted` is a public
-- boolean (kept in sync with vote by a trigger) so clients can show the
-- "X/Y voted" count and the "everyone voted" gate without seeing targets.
-- `consultation_tally` returns the aggregate outcome (imprisoned / tie /
-- skip / none) for the result screen, again without revealing votes.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

alter table players add column if not exists has_voted boolean not null default false;

-- Keep has_voted = (vote is not null) on every write. BEFORE trigger so it
-- applies to the same row being written, regardless of which code path set
-- the vote.
create or replace function sync_has_voted()
returns trigger
language plpgsql
as $$
begin
  new.has_voted := new.vote is not null;
  return new;
end;
$$;

drop trigger if exists trg_sync_has_voted on players;
create trigger trg_sync_has_voted
  before insert or update on players
  for each row execute function sync_has_voted();

-- Backfill existing rows (the trigger recomputes it).
update players set has_voted = (vote is not null);

-- Aggregate consultation outcome for the result screen, computed from
-- player_secrets so individual votes never reach the browser. Returns
-- { kind: 'imprisoned'|'tie'|'skip_majority'|'no_votes',
--   imprisoned_id: uuid|null, tied_ids: [uuid,...] }.
-- Mirrors computeTally in Consultation.tsx.
create or replace function consultation_tally(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_skip int := 0;
  v_max int := 0;
  v_topn int := 0;
  v_imprisoned text;
  v_tied jsonb;
begin
  select count(*) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, count(*) as c
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.in_prison and not p.dead and not p.in_hospital
      and s.vote is not null and s.vote <> 'skip'
    group by s.vote
  ),
  mx as (select coalesce(max(c), 0) as m from tally)
  select
    (select m from mx),
    (select count(*) from tally, mx where tally.c = mx.m and mx.m > 0),
    (select target from tally, mx where tally.c = mx.m and mx.m > 0 limit 1),
    coalesce((select jsonb_agg(target) from tally, mx where tally.c = mx.m and mx.m > 0), '[]'::jsonb)
  into v_max, v_topn, v_imprisoned, v_tied;

  if v_max = 0 then
    return jsonb_build_object('kind','no_votes','imprisoned_id',null,'tied_ids','[]'::jsonb);
  elsif v_skip >= v_max then
    return jsonb_build_object('kind','skip_majority','imprisoned_id',null,'tied_ids','[]'::jsonb);
  elsif v_topn > 1 then
    return jsonb_build_object('kind','tie','imprisoned_id',null,'tied_ids',v_tied);
  else
    return jsonb_build_object('kind','imprisoned','imprisoned_id',v_imprisoned,'tied_ids','[]'::jsonb);
  end if;
end;
$$;

grant execute on function consultation_tally(uuid) to anon, authenticated;

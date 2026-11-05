-- 145: Switch the court on (The Trial, 2026-11-05).
--
-- From the next consultation that opens, every room gets the court (docket →
-- trial → verdict → settlement, migrations 136–144) instead of the old vote;
-- a consultation already running finishes the way it started. Diligence's,
-- Truthfulness's and Justice's court abilities work from now on, and
-- Truthfulness's vote reveal and Justice's shield/kill end.
--
-- RUN THIS ONLY AFTER THE NEW CLIENT IS DEPLOYED (the court screens, and
-- private lobbies opening the consultation through start_consultation).
-- To switch back: the same function with `select false`.

begin;

create or replace function vv_court_live()
returns boolean language sql immutable as $$ select true $$;

commit;

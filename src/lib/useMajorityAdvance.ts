"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { Player, Room } from "./types";

// Seconds of countdown once a majority has pressed Continue/Proceed.
export const CONTINUE_SECONDS = 10;

// Majority-continue for a phase. When a majority of the electorate is "ready"
// (has pressed Continue / Proceed / Done), the host starts a visible 10-second
// countdown by setting room.phase_ends_at, then advances when it elapses. The
// host can still force it instantly (TopBar Skip).
//
// Stale `ready` from the previous phase is ignored until we've observed
// everyone reset to not-ready at least once (the resetSeen guard) — every
// transition into a majority-continue phase clears `ready`.
export function useMajorityAdvance(opts: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
  advance: () => void | Promise<void>;
  enabled?: boolean;
  // What marks a player as "ready" (default: their ready flag).
  readyOf?: (p: Player) => boolean;
  // Who counts toward the majority (default: active players).
  electorate?: (players: Player[]) => Player[];
}) {
  const {
    room,
    players,
    myPlayer,
    advance,
    enabled = true,
    readyOf = (p) => p.ready,
    electorate = (ps) =>
      ps.filter((p) => !p.dead && !p.in_prison && !p.in_hospital),
  } = opts;

  const isHost = myPlayer?.is_host ?? false;
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const advancedRef = useRef(false);

  // Reset guards whenever the phase changes.
  useEffect(() => {
    setResetSeen(false);
    advancedRef.current = false;
  }, [room.phase, room.day]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const voters = electorate(players);
  const total = voters.length;
  const readyCount = voters.filter(readyOf).length;

  // Trust readiness only after we've seen the phase's ready reset land.
  useEffect(() => {
    if (total > 0 && voters.every((p) => !readyOf(p))) setResetSeen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  const majority = enabled && resetSeen && total > 0 && readyCount * 2 > total;
  const endsAtMs = room.phase_ends_at ? Date.parse(room.phase_ends_at) : null;

  // Host: start (or shorten to) the 10s countdown once a majority is ready.
  // The guard only skips when a fresh countdown is already running (a deadline
  // in the next ~10s) — a stale deadline already in the past is overwritten.
  useEffect(() => {
    if (!enabled || !isHost || !majority) return;
    if (
      endsAtMs !== null &&
      endsAtMs > Date.now() &&
      endsAtMs - Date.now() <= (CONTINUE_SECONDS + 0.5) * 1000
    ) {
      return; // already counting down
    }
    void supabase
      .from("rooms")
      .update({
        phase_ends_at: new Date(Date.now() + CONTINUE_SECONDS * 1000).toISOString(),
      })
      .eq("id", room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isHost, majority, endsAtMs, room.id]);

  // Host: advance when the countdown elapses. We require `majority` (not just
  // an elapsed deadline) so an inherited stale phase_ends_at from a previous
  // sub-phase can never auto-advance before anyone has pressed Continue.
  useEffect(() => {
    if (!enabled || !isHost || advancedRef.current || !majority) return;
    if (endsAtMs !== null && now >= endsAtMs) {
      advancedRef.current = true;
      void Promise.resolve(advance());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isHost, now, endsAtMs, majority]);

  // Only surface a countdown once a majority has actually started one — a
  // phase_ends_at inherited from a previous sub-phase (or an already-elapsed
  // deadline) must not look like a pending advance.
  const remainingSec =
    majority && endsAtMs !== null && endsAtMs > now
      ? Math.max(1, Math.ceil((endsAtMs - now) / 1000))
      : null;

  return { remainingSec, readyCount, total, majority };
}

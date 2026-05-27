"use client";

import { useEffect, useRef, useState } from "react";
import { startNextDay } from "@/lib/game";
import type { Player, Room } from "@/lib/types";

// Splash screen shown between consultation and the next day's
// role-action. Auto-advances after a short timer (NEW_DAY_SECONDS,
// stored as room.phase_ends_at). The host's client triggers the
// actual advance.
export function NewDay({
  room,
  myPlayer,
}: {
  room: Room;
  myPlayer: Player | null;
}) {
  const advancedRef = useRef(false);
  const isHost = myPlayer?.is_host ?? false;

  const endsAtMs = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;

  // Live countdown for the splash text.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const remaining = endsAtMs
    ? Math.max(0, Math.ceil((endsAtMs - now) / 1000))
    : 0;

  // Host-only auto-advance once the timer expires.
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    if (!endsAtMs) return;
    if (now < endsAtMs) return;
    advancedRef.current = true;
    startNextDay(room.id, room.day);
  }, [isHost, endsAtMs, now, room.id, room.day]);

  // The day shown should be the NEXT day, since this splash is the
  // transition into it. room.day is still the day that just ended.
  const nextDay = room.day + 1;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-home-bg px-6 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">
        A new day in the castle
      </p>
      <h1 className="mt-2 text-5xl font-semibold">Day {nextDay}</h1>
      <p className="mt-6 max-w-xs text-center text-sm text-cream/70">
        Use your ability again &mdash; the next reflection begins in {remaining}.
      </p>
    </main>
  );
}

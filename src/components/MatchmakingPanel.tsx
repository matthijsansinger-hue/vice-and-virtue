"use client";

import { useMemo } from "react";
import { heading } from "@/components/ui/royal";
import { ClassPreferencePicker } from "./ClassPreferencePicker";
import { LoadingScreen } from "./LoadingScreen";
import {
  QUEUE_PATIENCE_MS,
  CLASS_PREF_KEY,
  parseClassPreference,
  type ClassPreference,
  type QueueKind,
} from "@/lib/matchmaking";
import { useMatchmaking } from "@/lib/useMatchmaking";
import { useStoredString } from "@/lib/useStoredString";

// The whole queue flow for both public and ranked (migration 117): pick a class
// per camp, search, and enter the room the moment the matchmaker seats you.
// The polling/seat-resolution logic lives in useMatchmaking (shared with the
// hub's Play button); this is the stand-alone panel the /ranked page uses.
export function MatchmakingPanel({
  kind,
  playerName,
  onCancel,
}: {
  kind: QueueKind;
  playerName: string;
  onCancel?: () => void;
}) {
  // The same remembered picks as the hub's Play button.
  const [storedPref, setStoredPref] = useStoredString(CLASS_PREF_KEY);
  const pref = useMemo(() => parseClassPreference(storedPref), [storedPref]);
  const setPref = (p: ClassPreference) => setStoredPref(JSON.stringify(p));
  const mm = useMatchmaking(kind, playerName);
  const { searching, waiting, elapsedMs, error } = mm;

  async function start() {
    await mm.start(kind, pref);
  }

  async function cancel() {
    await mm.cancel();
    onCancel?.();
  }

  const needed = mm.needed;
  const queueStatus = (
    <span>
      <strong className="text-cream">{waiting}</strong> waiting
      {needed > 0 ? (
        <>
          {" · needs "}
          <strong className="text-cream">{needed}</strong> more
        </>
      ) : (
        " · starting now"
      )}
    </span>
  );

  const pastPatience = elapsedMs >= QUEUE_PATIENCE_MS;
  const secs = Math.floor(elapsedMs / 1000);

  // A blank name means a guest hasn't filled the field above yet. Guard here so
  // the button explains itself rather than failing silently.
  const named = playerName.trim().length > 0;

  if (!searching) {
    return (
      <div>
        <ClassPreferencePicker value={pref} onChange={setPref} />
        <p className="mt-3 text-center text-sm text-cream/70">{queueStatus}</p>
        {error && (
          <p className="mt-3 text-center text-sm text-red-300">{error}</p>
        )}
        <button
          onClick={start}
          disabled={!named}
          title={named ? undefined : "Enter your name first"}
          className={`mt-4 w-full rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 disabled:shadow-none ${heading}`}
        >
          {!named
            ? "Enter your name first"
            : kind === "ranked"
              ? "Find ranked match"
              : "Find a game"}
        </button>
      </div>
    );
  }

  return (
    <LoadingScreen title="Searching for a game…" compact>
      <p className="mt-1 text-4xl font-bold tabular-nums text-cream">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </p>
      <p className="mt-2 text-sm text-cream/70">{queueStatus}</p>

      {/* Quick play shows no wait explanation before the minute: the game can
          start earlier, as soon as ANYONE in the queue has waited a minute, so
          a "you'll wait a minute" line was simply wrong. */}
      {(kind === "ranked" || pastPatience) && (
        <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-cream/55">
          {kind === "public"
            ? "Not enough players yet — bots are taking the empty seats so your game can start."
            : pastPatience
              ? "You've waited long enough that we'll now place you in any free class to get a game started."
              : "Holding out for the classes you picked. After a minute we'll place you anywhere free so you're not stuck waiting."}
        </p>
      )}

      <button
        onClick={cancel}
        className="mt-5 rounded-lg border border-gold/50 px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10"
      >
        Cancel search
      </button>
    </LoadingScreen>
  );
}

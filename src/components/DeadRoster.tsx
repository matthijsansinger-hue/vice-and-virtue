"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { heading } from "@/components/ui/royal";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { gameColors } from "@/lib/gameColors";
import { usePlayerCharacters } from "@/lib/usePlayerCharacters";
import type { Player, Room } from "@/lib/types";

// For DEAD players, always in the top bar: how many are still free, in prison
// and dead, at a glance; tap for everyone by name (face + this game's colour).
// "Free" = alive and not imprisoned (the infirmary still counts as free).

const STATE = {
  free: { label: "Free", dot: "#4fbf72" },
  prison: { label: "In prison", dot: "#9aa6b8" },
  dead: { label: "Dead", dot: "#e0605a" },
} as const;
type State = keyof typeof STATE;

const stateOf = (p: Player): State => (p.dead ? "dead" : p.in_prison ? "prison" : "free");

export function DeadRosterButton({ room, players }: { room: Room; players: Player[] }) {
  const [open, setOpen] = useState(false);
  const counts = { free: 0, prison: 0, dead: 0 };
  for (const p of players) counts[stateOf(p)] += 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Who's left: ${counts.free} free, ${counts.prison} in prison, ${counts.dead} dead`}
        title="Who's free, in prison and dead"
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-gold/60 px-2 py-1 text-[11px] font-bold tabular-nums text-cream transition-colors hover:bg-gold/15"
      >
        {(Object.keys(STATE) as State[]).map((s) => (
          <span key={s} className="flex items-center gap-0.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: STATE[s].dot }} />
            {counts[s]}
          </span>
        ))}
      </button>
      {open && <RosterModal room={room} players={players} onClose={() => setOpen(false)} />}
    </>
  );
}

function RosterModal({ room, players, onClose }: { room: Room; players: Player[]; onClose: () => void }) {
  const characters = usePlayerCharacters(players);
  const colors = useMemo(() => gameColors(room.id, players.map((p) => p.id)), [room.id, players]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = (Object.keys(STATE) as State[]).map((s) => ({
    state: s,
    people: players
      .filter((p) => stateOf(p) === s)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
  }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-6"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dead-roster-title"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-md rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream shadow-2xl"
      >
        <h1 id="dead-roster-title" className={`text-center text-lg font-bold text-gold ${heading}`}>
          Who&rsquo;s left
        </h1>
        <p className="mt-0.5 text-center text-xs text-cream/55">Only the dead see this.</p>

        <div className="mt-4 space-y-4">
          {groups.map(({ state, people }) => (
            <section key={state} aria-label={STATE[state].label}>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: STATE[state].dot }} />
                {STATE[state].label}
                <span className="text-cream/50">{people.length}</span>
              </p>
              {people.length === 0 ? (
                <p className="text-xs text-cream/45">Nobody.</p>
              ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {people.map((p) => {
                    const persona = p.shown_as ?? p.id;
                    const gc = colors.get(persona);
                    return (
                      <li key={p.id} className="flex flex-col items-center text-center">
                        <span
                          className={"relative block h-11 w-11 rounded-full " + (state === "dead" ? "grayscale opacity-70" : "")}
                          style={{ boxShadow: `0 0 0 2px ${gc?.hex ?? "#e9d9a8"}` }}
                        >
                          <CharacterAvatar
                            character={characters[persona] ?? null}
                            initials={p.name.charAt(0).toUpperCase()}
                            className="h-full w-full"
                            textClass="text-xs"
                          />
                          {state === "prison" && (
                            <span
                              aria-hidden
                              className="absolute inset-0 rounded-full"
                              style={{ background: "repeating-linear-gradient(90deg, transparent 0 6px, rgba(28,24,22,.85) 6px 9px)" }}
                            />
                          )}
                        </span>
                        <span
                          className="mt-1 block w-full truncate rounded-[4px] px-1 text-[11px] font-semibold leading-[18px]"
                          style={{
                            background: gc?.background ?? "#e9dcb5",
                            color: gc ? (gc.lightText ? "#fff7e6" : "#1c140c") : "#2a1c10",
                          }}
                        >
                          {p.name}
                        </span>
                        {state === "free" && p.in_hospital && (
                          <span className="mt-0.5 text-[10px] text-emerald-200/80">In the infirmary</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className={`mt-5 w-full rounded-lg border border-gold/60 py-2 text-sm font-semibold text-gold hover:bg-gold/15 ${heading}`}
        >
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}

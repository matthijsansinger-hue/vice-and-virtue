"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import type { Player, Room } from "@/lib/types";
import { CostLine } from "@/components/abilities/ui";
import { heading } from "@/components/ui/royal";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { displayedName } from "@/lib/swaps";
import { CastleMap } from "./CastleMap";
import { MapRoleButton } from "./MapTargetAbility";
import type { ToolIconProps } from "./tools";

// A role action that picks SEVERAL players on the castle map, paying per
// player, and seals them in one go: tap a player → choose (they wear the
// role's tool) or un-choose → a button under the map commits them all.
// Sociability's silence and imprisoned Vengeance's revenge are this.

export type MapMultiRole = {
  title: string;
  tint: string;
  accent: string;
  button: [string, string];
  cursor: string;
  Icon: ComponentType<ToolIconProps>;
  costPer: number;
  // The map menu's choose / un-choose buttons.
  pickVerb: string;
  unpickVerb: string;
  // A line in the map menu about the player (e.g. "Voted to jail you.").
  menuNote?: string;
  // The commit button, for n chosen ("Silence 2 players").
  commitLabel: (n: number) => string;
  busyLabel: string;
  // Once sealed, about the players chosen.
  outcome: (names: string, n: number) => string;
  // Once acted, when this device doesn't know whom.
  actedLine: string;
  clip: string | null;
};

const list = (names: string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(names);

export function MapMultiPick({
  role,
  myPlayer,
  players,
  room,
  prompt,
  canTarget = () => true,
  dimUnpickable = false,
  queuedIds = [],
  commit,
  intro,
  blockedLine = null,
}: {
  role: MapMultiRole;
  myPlayer: Player;
  players: Player[];
  room: Room;
  prompt: string;
  canTarget?: (p: Player) => boolean;
  dimUnpickable?: boolean;
  // Who the server says was chosen (after a refresh), if it can say.
  queuedIds?: string[];
  commit: (ids: string[]) => Promise<{ ok: true } | { ok: false; message: string }>;
  // Shown above the instructions (Sociability's always-on power).
  intro?: ReactNode;
  // Why nobody can be chosen right now (loading, nobody eligible).
  blockedLine?: string | null;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [sealed, setSealed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { play } = useAbilityAnimation();

  const acted = myPlayer.acted_this_day;
  const se = myPlayer.soul_energy;
  const done = queuedIds.length ? queuedIds : sealed;
  const choosing = !acted && done.length === 0 && !blockedLine;
  const cost = selected.length * role.costPer;
  const affordable = Math.floor(se / role.costPer);
  const canAfford = cost > 0 && cost <= se;
  const eligible = players.filter(
    (p) => !p.dead && p.id !== myPlayer.id && canTarget(p)
  ).length;

  const nameOf = (id: string) => {
    const p = players.find((x) => x.id === id);
    return p ? displayedName(p, room, players, myPlayer.id) : "someone";
  };

  function toggle(id: string) {
    setError(null);
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function seal() {
    if (!choosing || busy || !canAfford) return;
    setBusy(true);
    setError(null);
    try {
      const res = await commit(selected);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSealed(selected);
      await play(role.clip);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const line = done.length
    ? role.outcome(list(done.map(nameOf)), done.length)
    : acted
      ? role.actedLine
      : blockedLine ?? prompt;
  const strong = done.length > 0;

  return (
    <section aria-label={role.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className={`text-sm uppercase tracking-widest ${heading}`} style={{ color: role.tint }}>
          {role.title}
        </h2>
        <CostLine have={se} cost={cost || role.costPer} />
      </div>
      {intro}
      <p
        className={`mt-1 text-sm ${strong ? "font-semibold" : "text-cream/80"}`}
        style={strong ? { color: role.tint } : undefined}
        aria-live="polite"
      >
        {line}
      </p>

      <div className="mt-4">
        <CastleMap
          room={room}
          players={players}
          myPlayerId={myPlayer.id}
          cursor={choosing ? role.cursor : undefined}
          accent={role.accent}
          canPick={(p) => choosing && canTarget(p)}
          dimUnpickable={choosing && dimUnpickable}
          marks={done.length ? done : selected}
          dimOthers={done.length > 0}
          markIcon={<role.Icon className="h-[72%] w-[72%]" />}
          label={`Castle map: ${prompt}`}
          renderMenu={(p, { name, room: where, close }) => {
            const chosen = selected.includes(p.id);
            return (
              <>
                <p className={`truncate text-base font-semibold ${heading}`}>{name}</p>
                <p className="text-xs text-cream/60">
                  In the {where.name}.{role.menuNote ? ` ${role.menuNote}` : ""}
                </p>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    toggle(p.id);
                    close();
                  }}
                  className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-2 font-semibold text-cream shadow-[0_3px_10px_rgba(0,0,0,.45)] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  style={
                    chosen
                      ? { background: "rgba(255,239,197,.08)", boxShadow: "inset 0 0 0 1.5px rgba(255,239,197,.35)" }
                      : {
                          background: `linear-gradient(180deg, ${role.button[0]} 0%, ${role.button[1]} 100%)`,
                          textShadow: "0 1px 2px rgba(0,0,0,.45)",
                        }
                  }
                >
                  {!chosen && <role.Icon className="h-5 w-5 shrink-0" />}
                  <span className={heading}>{chosen ? role.unpickVerb : role.pickVerb}</span>
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="mt-1.5 w-full cursor-pointer rounded-lg py-1.5 text-sm text-cream/70 transition-colors hover:bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  Cancel
                </button>
              </>
            );
          }}
        />
      </div>

      {choosing && (
        <div className="mx-auto mt-4 max-w-sm">
          <p className="mb-2 text-center text-xs text-cream/60">
            {selected.length
              ? `Chosen: ${list(selected.map(nameOf))}.`
              : "Tap someone on the map to choose them."}{" "}
            You can afford {Math.min(affordable, eligible)} of {eligible}.
          </p>
          <MapRoleButton
            role={role}
            label={busy ? role.busyLabel : role.commitLabel(selected.length)}
            cost={busy ? undefined : cost}
            onClick={seal}
            disabled={!selected.length || !canAfford || busy}
          />
          {selected.length > 0 && !canAfford && (
            <p className="mt-2 text-center text-sm" style={{ color: role.tint }}>
              You need {cost} Soul Energy for {selected.length}. You have {se}.
            </p>
          )}
          {error && (
            <p className="mt-2 text-center text-sm" style={{ color: role.tint }}>
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

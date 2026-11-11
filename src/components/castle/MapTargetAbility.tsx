"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { queueAction } from "@/lib/game";
import type { Player, Room } from "@/lib/types";
import { CostLine } from "@/components/abilities/ui";
import { heading, SoulCost } from "@/components/ui/royal";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { displayedName } from "@/lib/swaps";
import { CastleMap } from "./CastleMap";
import type { ToolIconProps } from "./tools";

// A role action that picks ONE player on the castle map and acts on them: tap
// a player → one of the role's buttons → done, and the target wears the role's
// tool. Each button is an action: most queue one that resolves when the
// role-action phase ends (`action`, via queue_action — Murder, Vengeance,
// Intoxication, Torment, Envy); others call their own server function
// straight away (`perform` — Fanaticism's bomb, Greed, Certainty, Wrath's and
// Love's conversions, Generosity's two gifts). A role's untargeted options
// (Wrath giving up a follower, Love arming the deciding vote) sit under the
// map (`below`). Server calls and animations are the same as before the map.

// What an instant (`perform`) action reports back. A failure keeps the map
// open with `message` as the line above it; `avoid` also takes that player
// off the map's pickable set (e.g. they already carry a bomb).
export type MapTargetResult =
  | { ok: true }
  | { ok: false; message: string; avoid?: boolean };

export type MapAction = {
  // The button's word, e.g. "Kill".
  verb: string;
  // The verb in a sentence, when the button's word is too short alone
  // (default: the verb in lower case) — "You need 50 Soul Energy to …".
  doing?: string;
  // The button's screen-reader label (default: "<verb> <name>").
  actionLabel?: (name: string) => string;
  // A short line under the button, when the role offers several.
  hint?: string;
  cost: number;
  // A queued action names its queue_action kind…
  action?: Parameters<typeof queueAction>[3];
  // …an instant one runs its own server call instead.
  perform?: (me: Player, target: Player, name: string) => Promise<MapTargetResult>;
  clip: string | null;
  // What will happen (queued) or happened (instant), once done.
  outcome: (name: string) => string;
};

export type MapTargetRole = {
  title: string;
  // Light tint of the role colour, for the heading and the done line.
  tint: string;
  // Bright role colour: hover / open ring, the mark's disc.
  accent: string;
  // The action buttons' gradient, top → bottom (dark enough for cream text).
  button: [string, string];
  cursor: string;
  Icon: ComponentType<ToolIconProps>;
  actions: MapAction[];
  // Who can be picked, beyond being on the map and not you (default: anyone).
  canTarget?: (p: Player) => boolean;
  // What to do, before acting.
  prompt: string;
  // Once acted, when this device doesn't know on whom (default: "You
  // already acted today.").
  actedLine?: string;
};

export function MapTargetAbility({
  role,
  myPlayer,
  players,
  room,
  status,
  unavailable = null,
  doneLine = null,
  markIcon,
  below,
  showDead = false,
}: {
  role: MapTargetRole;
  myPlayer: Player;
  players: Player[];
  room: Room;
  // An extra line under the instructions (e.g. bombs left to plant).
  status?: ReactNode;
  // Why the ability can't be used right now, if it can't (the map stays
  // visible but nobody can be picked).
  unavailable?: string | null;
  // What an untargeted option just did (it replaces the line above the map).
  doneLine?: string | null;
  // The mark on the target, instead of the role's tool (Certainty: the
  // revealed role).
  markIcon?: ReactNode;
  // Untargeted options, under the map.
  below?: ReactNode;
  // Put the dead on the map too (Certainty).
  showDead?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // The target picked on this device + which action, shown until the
  // server's copy arrives.
  const [picked, setPicked] = useState<{ id: string; action: number } | null>(null);
  // A failed attempt's explanation, and the players it ruled out.
  const [note, setNote] = useState<string | null>(null);
  const [avoid, setAvoid] = useState<string[]>([]);
  const { play } = useAbilityAnimation();
  const { Icon } = role;

  const acted = myPlayer.acted_this_day;
  const se = myPlayer.soul_energy;
  const queued = role.actions.findIndex(
    (a) => !!a.action && a.action === myPlayer.pending_action
  );
  const done =
    queued >= 0 && myPlayer.pending_target
      ? { id: myPlayer.pending_target, action: queued }
      : acted
        ? picked
        : null;
  const target = done ? players.find((p) => p.id === done.id) : undefined;
  const targetName = target ? displayedName(target, room, players, myPlayer.id) : null;

  const usable = !acted && !unavailable;
  const pickable = (p: Player) =>
    usable && !avoid.includes(p.id) && (role.canTarget?.(p) ?? true);
  const cheapest = role.actions.reduce((a, b) => (b.cost < a.cost ? b : a));
  const tooPoor = (a: MapAction) =>
    `You need ${a.cost} Soul Energy to ${a.doing ?? a.verb.toLowerCase()}. You have ${se}.`;

  async function act(i: number, p: Player, name: string, close: () => void) {
    const a = role.actions[i];
    if (!usable || busy || se < a.cost) return;
    setBusy(true);
    try {
      let res: MapTargetResult = { ok: true };
      if (a.perform) {
        try {
          res = await a.perform(myPlayer, p, name);
        } catch {
          res = { ok: false, message: "That didn't go through. Try again." };
        }
      } else if (a.action) {
        await queueAction(myPlayer.id, a.cost, se, a.action, p.id);
      }
      close();
      if (!res.ok) {
        setNote(res.message);
        if (res.avoid) setAvoid((x) => [...x, p.id]);
        return;
      }
      setNote(null);
      setPicked({ id: p.id, action: i });
      await play(a.clip);
    } finally {
      setBusy(false);
    }
  }

  const line =
    done && targetName
      ? role.actions[done.action].outcome(targetName)
      : doneLine
        ? doneLine
        : acted
          ? role.actedLine ?? "You already acted today."
          : unavailable
            ? unavailable
            : se < cheapest.cost
              ? tooPoor(cheapest)
              : note ?? role.prompt;
  const lineStrong = !!targetName || !!doneLine || (!!note && usable);

  return (
    <section aria-label={role.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2
          className={`text-sm uppercase tracking-widest ${heading}`}
          style={{ color: role.tint }}
        >
          {role.title}
        </h2>
        <CostLine have={se} cost={cheapest.cost} />
      </div>
      <p
        className={`mt-1 text-sm ${lineStrong ? "font-semibold" : "text-cream/80"}`}
        style={lineStrong ? { color: role.tint } : undefined}
        aria-live="polite"
      >
        {line}
      </p>
      {status && <div className="mt-1 text-xs text-cream/60">{status}</div>}

      <div className="mt-4">
        <CastleMap
          room={room}
          players={players}
          myPlayerId={myPlayer.id}
          cursor={usable ? role.cursor : undefined}
          accent={role.accent}
          canPick={pickable}
          // When only some can be picked, the rest step back.
          dimUnpickable={usable && (!!role.canTarget || avoid.length > 0)}
          showDead={showDead}
          marks={done ? [done.id] : []}
          markIcon={markIcon ?? <Icon className="h-[72%] w-[72%]" />}
          label={`Castle map: ${role.prompt}`}
          renderMenu={(p, { name, room: where, dead, close }) => {
            const firstAffordable = role.actions.findIndex((a) => se >= a.cost);
            return (
              <>
                <p className={`truncate text-base font-semibold ${heading}`}>{name}</p>
                <p className="text-xs text-cream/60">
                  {dead ? `Dead, lying in the ${where.name}` : `In the ${where.name}`}
                </p>
                {role.actions.map((a, i) =>
                  se >= a.cost ? (
                    <div key={a.verb} className="mt-3">
                      <button
                        type="button"
                        autoFocus={i === firstAffordable}
                        aria-label={`${a.actionLabel?.(name) ?? `${a.verb} ${name}`} for ${a.cost} Soul Energy`}
                        disabled={busy}
                        onClick={() => act(i, p, name, close)}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-2 font-semibold text-cream shadow-[0_3px_10px_rgba(0,0,0,.45)] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-wait disabled:opacity-60"
                        style={{
                          background: `linear-gradient(180deg, ${role.button[0]} 0%, ${role.button[1]} 100%)`,
                          textShadow: "0 1px 2px rgba(0,0,0,.45)",
                        }}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className={heading}>{a.verb}</span>
                        <span className="ml-0.5 whitespace-nowrap rounded-full bg-black/35 px-2 py-0.5 text-xs">
                          <SoulCost value={a.cost} />
                        </span>
                      </button>
                      {a.hint && (
                        <p className="mt-1 text-center text-[11px] leading-snug text-cream/60">
                          {a.hint}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p key={a.verb} className="mt-3 text-xs" style={{ color: role.tint }}>
                      {tooPoor(a)}
                    </p>
                  )
                )}
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

      {below && <div className="mx-auto mt-4 max-w-sm">{below}</div>}
    </section>
  );
}

// A full-width role button for an untargeted option under the map (Wrath's
// relinquish, Love's deciding vote, a multi-pick's commit), styled like the
// map menu's buttons.
export function MapRoleButton({
  role,
  label,
  cost,
  onClick,
  disabled,
  hint,
}: {
  role: Pick<MapTargetRole, "button" | "Icon">;
  label: string;
  cost?: number;
  onClick: () => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const { Icon } = role;
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-semibold text-cream shadow-[0_3px_12px_rgba(0,0,0,.45)] transition-[filter,opacity] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
        style={{
          background: `linear-gradient(180deg, ${role.button[0]} 0%, ${role.button[1]} 100%)`,
          textShadow: "0 1px 2px rgba(0,0,0,.45)",
        }}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className={heading}>{label}</span>
        {!!cost && (
          <span className="ml-1 whitespace-nowrap rounded-full bg-black/35 px-2 py-0.5 text-xs">
            <SoulCost value={cost} />
          </span>
        )}
      </button>
      {hint && <p className="mt-1.5 text-center text-xs text-cream/60">{hint}</p>}
    </div>
  );
}

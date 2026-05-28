"use client";

import { useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/roles";
import {
  setReady,
  endRoleAction,
  ROLE_ACTION_SECONDS,
} from "@/lib/game";
import { Centered } from "./Centered";
import { CertaintyAction } from "./abilities/CertaintyAction";
import { EmpathyAction } from "./abilities/EmpathyAction";
import { MurderAction } from "./abilities/MurderAction";
import { JusticeAction } from "./abilities/JusticeAction";
import { IntoxicationAction } from "./abilities/IntoxicationAction";
import { VengeanceAction } from "./abilities/VengeanceAction";
import { SacrificeAction } from "./abilities/SacrificeAction";
import { WorshipperSeekerAction } from "./abilities/WorshipperSeekerAction";
import { EnvyAction } from "./abilities/EnvyAction";
import { TormentAction } from "./abilities/TormentAction";
import { CampMessagesPanel } from "./CampMessagesPanel";
import type { Room, Player } from "@/lib/types";

const IMPLEMENTED_ABILITIES = new Set([
  "certainty",
  "empathy",
  "murder",
  "justice",
  "intoxication",
  "vengeance",
  "sacrifice",
  // Truthfulness's action lives in the consultation result screen, not
  // here, but we still want a friendly explainer instead of the generic
  // "not implemented" placeholder.
  "truthfulness",
  "vice_worshipper",
  "virtue_seeker",
  "envy",
  "torment",
]);

export function RoleAction({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  const active = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : ROLE_ACTION_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  useEffect(() => {
    if (active.length > 0 && active.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      expired &&
      myPlayer &&
      !myPlayer.in_prison &&
      !myPlayer.dead &&
      !myPlayer.in_hospital &&
      !myPlayer.ready
    ) {
      setReady(myPlayer.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  const allReady = active.length > 0 && active.every((p) => p.ready);
  const graceOver = endsAt !== null && now > endsAt + 5000;
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const everyoneDone = resetSeen && allReady;
    if (everyoneDone || graceOver) {
      advancedRef.current = true;
      endRoleAction(room.id);
    }
  }, [isHost, resetSeen, allReady, graceOver, room.id]);

  async function done() {
    if (!myPlayer || myPlayer.ready) return;
    await setReady(myPlayer.id, true);
  }

  // Dead: passive screen, no action.
  if (myPlayer?.dead) {
    return (
      <Centered className="reflection-stars-bg text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Day {room.day}
        </p>
        <p className="mt-2 text-2xl font-semibold">You&rsquo;re dead</p>
        <p className="mt-2 text-cream/70">The game continues without you.</p>
      </Centered>
    );
  }

  // In hospital: passive, recovers tomorrow.
  if (myPlayer?.in_hospital) {
    return (
      <Centered className="reflection-stars-bg text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Day {room.day}
        </p>
        <p className="mt-2 text-2xl font-semibold">You&rsquo;re in hospital</p>
        <p className="mt-2 text-cream/70">
          You skip this day. You&rsquo;ll recover tomorrow.
        </p>
      </Centered>
    );
  }

  // Imprisoned: passive screen, no action.
  if (myPlayer?.in_prison) {
    return (
      <Centered className="reflection-stars-bg text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Day {room.day}
        </p>
        <p className="mt-2 text-xl font-semibold">You&rsquo;re in prison</p>
        <p className="mt-2 text-cream/70">You cannot use abilities.</p>
      </Centered>
    );
  }

  const role = myPlayer?.role ? ROLES[myPlayer.role] : undefined;
  const myCamp = role?.camp ?? null;

  if (myPlayer?.ready) {
    return (
      <Centered className="reflection-stars-bg text-cream">
        <p className="text-xl font-semibold">Done!</p>
        <p className="mt-2 text-cream/70">
          Waiting for the other players&hellip;
        </p>
        {myCamp && (
          <div className="mt-6 w-full max-w-md">
            <CampMessagesPanel roomId={room.id} camp={myCamp} />
          </div>
        )}
      </Centered>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center reflection-stars-bg px-4 py-8 text-cream">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-gold">
            Day {room.day} &mdash; role action
          </p>
          <p className="mt-1 text-5xl font-semibold tabular-nums">
            {remainingSec}
            <span className="text-2xl text-cream/60">s</span>
          </p>
        </div>

        {/* Camp messages panel: all active camp members see this. */}
        {myCamp && (
          <div className="mt-6">
            <CampMessagesPanel roomId={room.id} camp={myCamp} />
          </div>
        )}

        <div className="mt-6">
          {role?.id === "certainty" && myPlayer && (
            <CertaintyAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "empathy" && myPlayer && (
            <EmpathyAction
              myPlayer={myPlayer}
              players={players}
              day={room.day}
            />
          )}
          {role?.id === "murder" && myPlayer && (
            <MurderAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "justice" && myPlayer && (
            <JusticeAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "intoxication" && myPlayer && (
            <IntoxicationAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "vengeance" && myPlayer && (
            <VengeanceAction
              myPlayer={myPlayer}
              players={players}
              room={room}
            />
          )}
          {role?.id === "sacrifice" && myPlayer && (
            <SacrificeAction
              myPlayer={myPlayer}
              players={players}
              room={room}
              mode="queued"
            />
          )}
          {role?.id === "truthfulness" && (
            <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
              <p className="text-sm uppercase tracking-widest text-gold">
                Truthfulness
              </p>
              <p className="mt-2 text-sm text-cream/80">
                Your ability is used during the consultation phase, after a
                player has been imprisoned. Tap Done to continue.
              </p>
            </div>
          )}
          {(role?.id === "vice_worshipper" ||
            role?.id === "virtue_seeker") &&
            myPlayer && (
              <WorshipperSeekerAction myPlayer={myPlayer} roomId={room.id} />
            )}
          {role?.id === "envy" && myPlayer && (
            <EnvyAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "torment" && myPlayer && (
            <TormentAction myPlayer={myPlayer} players={players} />
          )}
          {role && !IMPLEMENTED_ABILITIES.has(role.id) && (
            <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
              <p className="text-sm uppercase tracking-widest text-gold">
                {role.name}
              </p>
              <p className="mt-2 text-sm text-cream/80">
                Your ability isn&rsquo;t implemented yet. Tap Done to continue.
              </p>
            </div>
          )}
        </div>

        <button
          onClick={done}
          className="mt-6 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          {myPlayer && !myPlayer.acted_this_day
            ? "Skip ability & continue"
            : "Done"}
        </button>
        <p className="mt-2 text-center text-xs text-cream/50">
          Pressing this without using your ability counts as skipping it.
        </p>
      </div>
    </main>
  );
}

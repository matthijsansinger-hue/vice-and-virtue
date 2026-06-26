"use client";

import { useEffect, useState } from "react";
import { convertPlayer, relinquishFollower, myFollowerCount } from "@/lib/game";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player } from "@/lib/types";

const CONVERT_COST = 200;
const RELINQUISH_COST = 100;

// Wrath (one ability per day): corrupt a Virtue into a Vice Worshipper bound to
// you as a follower (200 — charged even if the target wasn't a Virtue), OR give
// up one of your living followers for a lasting extra life (100).
export function WrathAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [mode, setMode] = useState<"corrupt" | "relinquish" | null>(null);
  const { play } = useAbilityAnimation();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  // Conversion only lands on an active target (server rejects dead / imprisoned
  // / hospitalised), so don't offer them.
  const targets = players.filter(
    (p) => !p.dead && !p.in_prison && !p.in_hospital && p.id !== myPlayer.id
  );

  // Load the living-follower count (drives the relinquish option).
  useEffect(() => {
    let alive = true;
    myFollowerCount(myPlayer.id).then((n) => {
      if (alive) setFollowers(n);
    });
    return () => {
      alive = false;
    };
  }, [myPlayer.id]);

  async function corrupt(target: Player) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await convertPlayer(myPlayer.id, target.id);
      // Corruption animation is played by AbilityOutcomeWatcher only if it takes
      // hold (resolved at end of role-action), not on tap.
      if (res.ok) {
        setDone(
          `Your corruption is set on ${target.name}. It takes hold when the role phase ends — you'll be told whether it worked.`
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function relinquish() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await relinquishFollower(myPlayer.id);
      await play(clipForAbility("wrath", "relinquish"));
      if (ok) {
        setDone("You consumed a follower's life for a lasting extra life.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">Wrath</p>
        <p className="mt-2">{done}</p>
      </div>
    );
  }

  if (alreadyActed) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Wrath</p>
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Wrath</p>
        <p className="mt-2 text-sm text-cream/80">Choose your wrath today.</p>
        <p className="mt-2 text-xs text-cream/60">
          Soul Energy:{" "}
          <span className="font-semibold">{myPlayer.soul_energy}</span>
          {followers !== null && (
            <>
              {" "}
              &middot; Followers:{" "}
              <span className="font-semibold">{followers}</span>
            </>
          )}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => setMode("corrupt")}
            disabled={myPlayer.soul_energy < CONVERT_COST}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Corrupt a Virtue into your Worshipper (200 SE)
          </button>
          <button
            onClick={() => setMode("relinquish")}
            disabled={
              myPlayer.soul_energy < RELINQUISH_COST ||
              followers === null ||
              followers < 1
            }
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Relinquish a follower for an extra life (100 SE)
            {followers !== null && followers < 1 && (
              <span className="ml-1 text-xs text-home-bg/50">
                (no followers)
              </span>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "relinquish") {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Wrath</p>
        <p className="mt-2 text-sm text-cream/80">
          Consume one follower&rsquo;s life. They die, and you gain a lasting
          extra life that absorbs a future kill or hospitalisation.
        </p>
        <p className="mt-2 text-xs text-cream/60">
          Living followers:{" "}
          <span className="font-semibold">{followers ?? 0}</span>
        </p>
        <button
          onClick={relinquish}
          disabled={busy || (followers ?? 0) < 1}
          className="mt-4 w-full rounded-lg border border-gold bg-cream px-4 py-3 text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Relinquish a follower (100 SE)
        </button>
        <button
          onClick={() => setMode(null)}
          disabled={busy}
          className="mt-2 w-full rounded-lg border border-gold/50 px-4 py-2 text-sm text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Wrath</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick who to corrupt. It only takes hold on a Virtue who isn&rsquo;t an
        S-tier role — but your offering is spent either way, so choose someone
        you believe serves the light.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {targets.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => corrupt(p)}
              disabled={busy}
              className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setMode(null)}
        disabled={busy}
        className="mt-2 w-full rounded-lg border border-gold/50 px-4 py-2 text-sm text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
      >
        Back
      </button>
    </div>
  );
}

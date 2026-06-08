"use client";

// Profile "Account" panel: shows the account level + XP bar, the two
// currencies (Souls / Mano), and the unopened Soul Shards with an Open
// button that reveals what the shard rolled. Self-contained — it fetches
// the current user's economy itself.

import { useEffect, useState } from "react";
import {
  getMyEconomy,
  openSoulShard,
  claimDailyLogin,
  levelFromXp,
  SOULS_NAME,
  MANO_NAME,
  type AccountEconomy,
  type ShardReward,
} from "@/lib/economy";
import { ROLES } from "@/lib/roles";

export function AccountPanel() {
  const [econ, setEcon] = useState<AccountEconomy | null>(null);
  const [opening, setOpening] = useState(false);
  const [reward, setReward] = useState<ShardReward | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      // Make sure today's daily-login shard is granted before we read the
      // balance, so it shows on the first profile visit of the day. Idempotent
      // + day-guarded, so this is a no-op if useAuth already claimed it.
      await claimDailyLogin();
      const e = await getMyEconomy();
      if (active) setEcon(e);
    })().catch(() => {
      /* non-critical */
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleOpen() {
    if (!econ || econ.unopened_shards <= 0 || opening) return;
    setOpening(true);
    setReward(null);
    try {
      const r = await openSoulShard();
      setReward(r);
      if (r.kind !== "none") {
        const fresh = await getMyEconomy();
        if (fresh) setEcon(fresh);
      }
    } catch {
      /* ignore — leave balances as they were */
    } finally {
      setOpening(false);
    }
  }

  if (!econ) return null;
  const lvl = levelFromXp(econ.xp);

  return (
    <div className="rounded-xl border border-gold/60 bg-home-bg/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gold">Account</h2>
        <span className="text-sm text-cream/70">Level {lvl.level}</span>
      </div>

      {/* XP toward next level */}
      <div className="mt-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-cream/15">
          <div
            className="h-full rounded-full bg-gold transition-[width]"
            style={{ width: `${Math.round(lvl.progress * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-right text-xs text-cream/60">
          {lvl.xpIntoLevel}/{lvl.xpForNext} XP
        </p>
      </div>

      {/* Currencies */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-cream/20 px-3 py-2">
          <p className="text-xs text-cream/60">{SOULS_NAME}</p>
          <p className="text-lg font-semibold text-cream">{econ.souls}</p>
        </div>
        <div className="rounded-lg border border-cream/20 px-3 py-2">
          <p className="text-xs text-cream/60">{MANO_NAME}</p>
          <p className="text-lg font-semibold text-cream">{econ.mano}</p>
        </div>
      </div>

      {/* Soul Shards */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-cream/80">
          Soul Shards: <b className="text-cream">{econ.unopened_shards}</b>
        </span>
        <button
          onClick={handleOpen}
          disabled={econ.unopened_shards <= 0 || opening}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {opening ? "Opening…" : "Open Shard"}
        </button>
      </div>

      {reward && <RewardLine reward={reward} />}
    </div>
  );
}

function RewardLine({ reward }: { reward: ShardReward }) {
  let text: string;
  if (reward.kind === "none") {
    return <p className="mt-3 text-sm text-cream/60">No shards to open right now.</p>;
  } else if (reward.kind === "souls") {
    text = `Soul Shard opened: +${reward.amount} ${SOULS_NAME} and +${reward.xp_gained} XP.`;
  } else if (reward.kind === "mano") {
    text = `Soul Shard opened: +${reward.amount} ${MANO_NAME} and +${reward.xp_gained} XP.`;
  } else {
    const name = ROLES[reward.role]?.name ?? reward.role;
    text = `Soul Shard opened: unlocked ${name}! (+${reward.xp_gained} XP)`;
  }
  return (
    <p className="mt-3 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm text-cream">
      {text}
    </p>
  );
}

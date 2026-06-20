"use client";

// Profile "Account" panel: account level + XP bar, the two currencies (Life
// Experience / Mano), and the unopened Soul Fragments with an Open button that
// pops a reveal of what the fragment rolled. A "Roles" button opens the roles
// collection / unlock shop. Self-contained — it fetches the economy itself.

import { useEffect, useState } from "react";
import {
  getMyEconomy,
  openSoulShard,
  claimDailyLogin,
  levelFromXp,
  LE_NAME,
  LE_ABBR,
  MANO_NAME,
  type AccountEconomy,
  type ShardReward,
} from "@/lib/economy";
import {
  NAME_TEXT_COLOR,
  NAME_TEXT_SHADOW,
  BANNER_BG,
  COLOR_TIER_LABEL,
} from "@/lib/levelColors";
import { ROLES } from "@/lib/roles";
import { RoleShop } from "@/components/RoleShop";

export function AccountPanel() {
  const [econ, setEcon] = useState<AccountEconomy | null>(null);
  const [opening, setOpening] = useState(false);
  const [reward, setReward] = useState<ShardReward | null>(null);
  const [showShop, setShowShop] = useState(false);

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
    try {
      const r = await openSoulShard();
      if (r.kind !== "none") {
        setReward(r);
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
            className="h-full rounded-full bg-gold"
            style={{
              width: `${Math.round(lvl.progress * 100)}%`,
              transition: "width 300ms ease",
            }}
          />
        </div>
        <p className="mt-1 text-right text-xs text-cream/60">
          {lvl.xpIntoLevel}/{lvl.xpForNext} XP
        </p>
      </div>

      {/* Currencies */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-cream/20 px-3 py-2">
          <p className="text-xs text-cream/60">{LE_NAME}</p>
          <p className="text-lg font-semibold text-cream">
            {econ.le}{" "}
            <span className="text-xs font-normal text-cream/50">{LE_ABBR}</span>
          </p>
        </div>
        <div className="rounded-lg border border-cream/20 px-3 py-2">
          <p className="text-xs text-cream/60">{MANO_NAME}</p>
          <p className="text-lg font-semibold text-cream">{econ.mano}</p>
        </div>
      </div>

      {/* Soul Fragments */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-cream/80">
          Soul Fragments: <b className="text-cream">{econ.unopened_shards}</b>
        </span>
        <button
          onClick={handleOpen}
          disabled={econ.unopened_shards <= 0 || opening}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {opening ? "Opening…" : "Open Fragment"}
        </button>
      </div>

      <button
        onClick={() => setShowShop(true)}
        className="mt-3 w-full rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
      >
        Roles
      </button>

      {reward && reward.kind !== "none" && (
        <ShardReveal
          reward={reward}
          canOpenMore={econ.unopened_shards > 0 && !opening}
          onOpenMore={handleOpen}
          onClose={() => setReward(null)}
        />
      )}

      {showShop && (
        <RoleShop
          le={econ.le}
          unlockedRoles={econ.unlockedRoles}
          onClose={() => setShowShop(false)}
          onUnlocked={(role, newLe) =>
            setEcon((cur) =>
              cur
                ? {
                    ...cur,
                    le: newLe,
                    unlockedRoles: Array.from(
                      new Set([...cur.unlockedRoles, role])
                    ),
                  }
                : cur
            )
          }
        />
      )}
    </div>
  );
}

// The shard-open reveal: a centered modal that scales in and shows what the
// shard rolled, with the guaranteed XP and an "open another" if more remain.
function ShardReveal({
  reward,
  canOpenMore,
  onOpenMore,
  onClose,
}: {
  reward: Exclude<ShardReward, { kind: "none" }>;
  canOpenMore: boolean;
  onOpenMore: () => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    const t = setTimeout(() => setShown(true), 30);
    return () => clearTimeout(t);
  }, [reward]);

  let headline: string;
  let detail: string | null = null;
  if (reward.kind === "le") {
    headline = `+${reward.amount} ${LE_ABBR}`;
    detail = LE_NAME;
  } else if (reward.kind === "mano") {
    headline = `+${reward.amount} ${MANO_NAME}`;
  } else {
    headline = ROLES[reward.role]?.name ?? reward.role;
    detail = "New role unlocked!";
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-2xl border border-gold/60 bg-home-bg p-6 text-center text-cream"
        style={{
          transform: shown ? "scale(1)" : "scale(0.9)",
          opacity: shown ? 1 : 0,
          transition: "transform 300ms ease, opacity 300ms ease",
        }}
      >
        <p className="text-xs uppercase tracking-wide text-cream/50">
          Soul Fragment
        </p>
        <div
          className="mx-auto mt-3 h-20 w-20 rotate-45 rounded-lg"
          style={{
            background: BANNER_BG[reward.rarity],
            boxShadow: `0 0 30px ${NAME_TEXT_COLOR[reward.rarity]}99`,
          }}
        />
        <p
          className="mt-4 text-sm font-semibold uppercase tracking-widest"
          style={{ color: NAME_TEXT_COLOR[reward.rarity], textShadow: NAME_TEXT_SHADOW }}
        >
          {COLOR_TIER_LABEL[reward.rarity]}
        </p>
        <p className="mt-1 text-2xl font-bold text-gold">{headline}</p>
        {detail && <p className="mt-1 text-sm text-cream/70">{detail}</p>}
        <p className="mt-2 text-xs text-cream/50">+{reward.xp_gained} XP</p>

        <div className="mt-5 flex gap-2">
          {canOpenMore && (
            <button
              onClick={onOpenMore}
              className="flex-1 rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Open another
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gold px-3 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            Nice!
          </button>
        </div>
      </div>
    </div>
  );
}

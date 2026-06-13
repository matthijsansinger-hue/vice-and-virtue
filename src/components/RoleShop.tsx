"use client";

// The roles collection / unlock shop, shown as a modal from the profile's
// Account panel. Lists every role with its art (RoleIcon), camp + tier, and
// an Owned tag or an "unlock for N LE" button. Currently all 12 roles are
// unlocked by default, so everything shows as Owned — this screen is ready
// for the roles added later, which will appear here as unlockable.

import { useState } from "react";
import { ROLES } from "@/lib/roles";
import { RoleIcon } from "@/components/RoleIcon";
import { unlockRoleWithLe, roleUnlockCost, LE_ABBR } from "@/lib/economy";

export function RoleShop({
  le,
  unlockedRoles,
  onClose,
  onUnlocked,
}: {
  le: number;
  unlockedRoles: string[];
  onClose: () => void;
  onUnlocked: (role: string, newLe: number) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owned = new Set(unlockedRoles);
  const roleList = Object.values(ROLES);
  const lockedCount = roleList.filter((r) => !owned.has(r.id)).length;

  async function handleUnlock(roleId: string) {
    if (busy) return;
    setBusy(roleId);
    setError(null);
    try {
      const res = await unlockRoleWithLe(roleId);
      if (res.ok && typeof res.le === "number") {
        onUnlocked(roleId, res.le);
      } else if (res.reason === "insufficient") {
        setError(`Not enough ${LE_ABBR}.`);
      } else if (res.reason === "owned") {
        onUnlocked(roleId, le); // already owned — just reflect it
      } else {
        setError("Could not unlock that role.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gold/60 bg-home-bg p-5 text-cream"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-gold">Roles</h2>
          <span className="shrink-0 text-sm text-cream/70">
            {le} {LE_ABBR}
          </span>
        </div>
        <p className="mt-1 text-xs text-cream/60">
          {lockedCount === 0
            ? "You own every role. New roles will be unlockable here as they're added."
            : `Unlock a new role — the price scales with its tier.`}
        </p>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {roleList.map((r) => {
            const isOwned = owned.has(r.id);
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-cream/15 bg-black/20 px-3 py-2"
              >
                <RoleIcon roleId={r.id} camp={r.camp} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.name}</p>
                  <p className="text-xs text-cream/60">
                    {r.camp === "vice" ? "Vice" : "Virtue"} · Tier {r.tier}
                  </p>
                </div>
                {isOwned ? (
                  <span className="shrink-0 rounded-md bg-cream/10 px-2 py-1 text-xs text-cream/70">
                    Owned
                  </span>
                ) : (
                  <button
                    onClick={() => handleUnlock(r.id)}
                    disabled={busy !== null || le < roleUnlockCost(r.tier)}
                    className="shrink-0 rounded-md bg-gold px-2.5 py-1 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {busy === r.id ? "…" : `${roleUnlockCost(r.tier)} ${LE_ABBR}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
        >
          Close
        </button>
      </div>
    </div>
  );
}

"use client";

// The ranked role-loadout editor: a button on the profile that opens a modal
// where you pick, for each side (Vice/Virtue) and each role tier (S/A/B/C/D),
// the role you'd rather be assigned in ranked games. Only unlocked roles are
// selectable. Tiers with a single role show it fixed (no choice yet).

import { useEffect, useState } from "react";
import {
  getMyRoleConfig,
  saveRoleConfig,
  rolesByTier,
  TIER_ORDER,
  type RoleConfig,
} from "@/lib/roleConfig";
import { getMyEconomy } from "@/lib/economy";
import { ROLES, type Camp, type Tier } from "@/lib/roles";
import { RoleIcon } from "@/components/RoleIcon";

export function RoleLoadout() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
      >
        Role loadout
      </button>
      {open && <LoadoutModal onClose={() => setOpen(false)} />}
    </>
  );
}

function LoadoutModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<RoleConfig | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [side, setSide] = useState<Camp>("vice");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [cfg, econ] = await Promise.all([getMyRoleConfig(), getMyEconomy()]);
      if (!active) return;
      setConfig(cfg);
      setUnlocked(new Set(econ?.unlockedRoles ?? []));
    })().catch(() => {
      /* non-critical */
    });
    return () => {
      active = false;
    };
  }, []);

  function choose(tier: Tier, roleId: string) {
    setConfig((cur) =>
      cur ? { ...cur, [side]: { ...cur[side], [tier]: roleId } } : cur
    );
    setSaved(false);
  }

  async function handleSave() {
    if (!config || saving) return;
    setSaving(true);
    try {
      await saveRoleConfig(config);
      setSaved(true);
    } catch {
      /* ignore — keep the modal open so they can retry */
    } finally {
      setSaving(false);
    }
  }

  const byTier = rolesByTier(side);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gold/60 bg-home-bg p-5 text-cream"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold text-gold">Ranked role loadout</h2>
        <p className="mt-1 text-xs text-cream/60">
          Your preferred role per tier on each side, used to pick your role in
          ranked games. More options open up as roles are added per tier.
        </p>

        <div className="mt-3 flex gap-2">
          {(["vice", "virtue"] as Camp[]).map((c) => (
            <button
              key={c}
              onClick={() => setSide(c)}
              aria-pressed={side === c}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition-colors ${
                side === c
                  ? "border-gold bg-gold text-home-bg"
                  : "border-gold/40 text-cream hover:bg-cream/10"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {!config ? (
          <p className="mt-4 text-sm text-cream/60">Loading…</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {TIER_ORDER.map((tier) => {
              const options = byTier[tier];
              if (options.length === 0) return null;
              const chosen = config[side][tier];
              return (
                <li
                  key={tier}
                  className="rounded-lg border border-cream/15 bg-black/20 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-gold/50 text-xs font-bold text-gold">
                      {tier}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-cream/50">
                      Tier {tier}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {options.map((roleId) => {
                      const isChosen = chosen === roleId;
                      const isUnlocked = unlocked.has(roleId);
                      return (
                        <button
                          key={roleId}
                          onClick={() => isUnlocked && choose(tier, roleId)}
                          disabled={!isUnlocked}
                          aria-pressed={isChosen}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                            isChosen
                              ? "border-gold bg-gold/15 text-cream"
                              : "border-cream/15 text-cream/80 hover:bg-cream/10"
                          } ${!isUnlocked ? "opacity-40" : ""}`}
                        >
                          <RoleIcon
                            roleId={roleId}
                            camp={side}
                            className="h-7 w-7"
                          />
                          <span>{ROLES[roleId]?.name ?? roleId}</span>
                          {!isUnlocked && (
                            <span className="text-xs text-cream/50">locked</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !config}
            className="flex-1 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

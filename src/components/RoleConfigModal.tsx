"use client";

import { useState } from "react";
import { setRoleConfig } from "@/lib/room";
import { ROLES, isPlayableRole, type Camp, type Tier } from "@/lib/roles";
import type { Room } from "@/lib/types";

const TIERS: Tier[] = ["S", "A", "B", "C", "D"];
type Config = Record<string, Partial<Record<string, string>>>;

// Host-only modal (random mode): per camp, per tier, pick which role fills
// that slot in the deal. Tiers with a single playable role are shown fixed;
// multi-option tiers (today: C) offer the choice plus "Random". Unset slots
// fall back to the server defaults. Saved to rooms.role_config.
export function RoleConfigModal({
  room,
  onClose,
}: {
  room: Room;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<Config>(() => ({
    vice: { ...(room.role_config?.vice ?? {}) },
    virtue: { ...(room.role_config?.virtue ?? {}) },
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function optionsFor(camp: Camp, tier: Tier) {
    return Object.values(ROLES).filter(
      (r) => r.camp === camp && r.tier === tier && isPlayableRole(r.id)
    );
  }

  function pick(camp: Camp, tier: Tier, roleId: string | null) {
    setConfig((c) => {
      const side = { ...(c[camp] ?? {}) };
      if (roleId === null) delete side[tier];
      else side[tier] = roleId;
      return { ...c, [camp]: side };
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setRoleConfig(room.id, config);
      onClose();
    } catch {
      setError("Couldn't save the configuration. Try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-lg font-semibold text-gold">
          Configure the roles
        </h2>
        <p className="mt-1 text-center text-xs text-cream/60">
          For the random deal: which role fills each tier slot. Tiers with one
          playable role are fixed; D fills with Worshippers/Seekers.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(["vice", "virtue"] as Camp[]).map((camp) => {
            const vice = camp === "vice";
            return (
              <section
                key={camp}
                className="rounded-xl border-2 bg-black/25 p-3"
                style={{ borderColor: vice ? "#9b2741" : "#3a49b8" }}
              >
                <h3
                  className="text-center text-sm font-semibold uppercase tracking-widest"
                  style={{ color: vice ? "#e6889a" : "#9a9ce0" }}
                >
                  {vice ? "Vices" : "Virtues"}
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {TIERS.map((tier) => {
                    const options = optionsFor(camp, tier);
                    const chosen = config[camp]?.[tier] ?? null;
                    return (
                      <li key={tier} className="rounded-lg bg-cream/5 px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gold/80 text-xs font-bold text-home-bg">
                            {tier}
                          </span>
                          {tier === "D" ? (
                            <span className="text-sm text-cream/70">
                              {vice ? "Vice Worshipper" : "Virtue Seeker"}{" "}
                              <span className="text-xs text-cream/45">
                                (fills the rest)
                              </span>
                            </span>
                          ) : options.length <= 1 ? (
                            <span className="text-sm text-cream/70">
                              {options[0]?.name ?? "—"}
                            </span>
                          ) : (
                            <div className="flex flex-1 flex-wrap gap-1">
                              {options.map((r) => (
                                <button
                                  key={r.id}
                                  onClick={() => pick(camp, tier, r.id)}
                                  className={
                                    "rounded px-2 py-1 text-xs font-semibold transition-colors " +
                                    (chosen === r.id
                                      ? "bg-gold text-home-bg"
                                      : "border border-gold/40 text-cream hover:bg-cream/10")
                                  }
                                >
                                  {r.name}
                                </button>
                              ))}
                              <button
                                onClick={() => pick(camp, tier, null)}
                                className={
                                  "rounded px-2 py-1 text-xs font-semibold transition-colors " +
                                  (chosen === null
                                    ? "bg-gold text-home-bg"
                                    : "border border-gold/40 text-cream hover:bg-cream/10")
                                }
                              >
                                Random
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm text-red-300">{error}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-lg border border-gold/50 py-2.5 text-sm font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-lg bg-gold py-2.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

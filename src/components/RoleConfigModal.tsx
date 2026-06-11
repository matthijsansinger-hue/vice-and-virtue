"use client";

import { useState } from "react";
import { IconX } from "@tabler/icons-react";
import { setRoleConfig } from "@/lib/room";
import { ROLES, isPlayableRole, type Camp, type Tier, type RoleDef } from "@/lib/roles";
import type { Room } from "@/lib/types";

const TIERS: Tier[] = ["S", "A", "B", "C", "D"];
type Config = Record<string, Partial<Record<string, string>>>;

// Host-only modal (random mode): per camp, per tier, pick which role fills
// that slot in the deal — shown as the actual role CARDS. Tiers with a single
// option are fixed; multi-option tiers (today: C) offer the cards plus a
// "Random" tile. Unset slots fall back to the server defaults. Saved to
// rooms.role_config.
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
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <h2 className="text-center text-lg font-semibold text-gold">
            Configure the roles
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-cream"
          >
            <IconX size={18} aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-center text-xs text-cream/60">
          For the random deal: which role fills each tier slot. Tiers with one
          option are fixed; D fills the rest with Worshippers/Seekers.
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
                <ul className="mt-2 flex flex-col gap-3">
                  {TIERS.map((tier) => {
                    const options = optionsFor(camp, tier);
                    const chosen = config[camp]?.[tier] ?? null;
                    const multi = tier !== "D" && options.length > 1;
                    return (
                      <li key={tier}>
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gold/80 text-[11px] font-bold text-home-bg">
                            {tier}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-cream/50">
                            {tier === "D"
                              ? "Fills the rest"
                              : multi
                                ? "Pick one — or leave it random"
                                : "Fixed"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {options.map((r) =>
                            multi ? (
                              <CardTile
                                key={r.id}
                                role={r}
                                selected={chosen === r.id}
                                onClick={() => pick(camp, tier, r.id)}
                              />
                            ) : (
                              <CardTile key={r.id} role={r} fixed />
                            )
                          )}
                          {multi && (
                            <button
                              type="button"
                              onClick={() => pick(camp, tier, null)}
                              className={
                                "flex w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed px-1 text-center transition-colors " +
                                (chosen === null
                                  ? "border-gold bg-gold/15 text-gold"
                                  : "border-cream/30 text-cream/60 hover:bg-cream/10")
                              }
                              style={{ aspectRatio: "2 / 3" }}
                            >
                              <span className="text-xl leading-none">?</span>
                              <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
                                Random
                              </span>
                            </button>
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

// One role card thumbnail. Selectable (ring when chosen) or fixed (the slot's
// only option — shown for context, not clickable).
function CardTile({
  role,
  selected = false,
  fixed = false,
  onClick,
}: {
  role: RoleDef;
  selected?: boolean;
  fixed?: boolean;
  onClick?: () => void;
}) {
  const vice = role.camp === "vice";
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/cards/${role.id}.png`} alt={role.name} className="block w-full" />
      <div
        className="absolute inset-x-0 bottom-0 px-1 pb-1 pt-4 text-center"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,.9), rgba(0,0,0,0))",
        }}
      >
        <span className="text-[10px] font-semibold leading-tight text-cream">
          {role.name}
        </span>
      </div>
    </>
  );
  if (fixed) {
    return (
      <div
        className="relative w-20 overflow-hidden rounded-lg border-2"
        style={{ borderColor: vice ? "#9b2741" : "#3a49b8" }}
      >
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "relative w-20 overflow-hidden rounded-lg border-2 transition-transform " +
        (selected ? "ring-2 ring-gold" : "hover:scale-[1.03]")
      }
      style={{ borderColor: selected ? "#e3b510" : vice ? "#9b2741" : "#3a49b8" }}
    >
      {body}
    </button>
  );
}
